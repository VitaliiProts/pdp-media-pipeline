#!/usr/bin/env bash
# Stage 5b: the app on EKS (docs/plan/stage-5b.md, ADR-017). Billed by the hour while up.
#
#   scripts/aws.sh up        # base and cluster layers, RDS on, cluster components, the app
#   scripts/aws.sh down      # the app with its volumes, the NLB, the cluster layer; RDS off
#   scripts/aws.sh status    # what runs, what is left behind, what it costs
#   scripts/aws.sh grafana   # Grafana on http://localhost:3000
#   scripts/aws.sh seed me   # create a user, print its API key
#   scripts/aws.sh release   # record and deploy the app at HEAD with TAGS (CI after a push)
#   scripts/aws.sh releases  # the last ten releases; rollback takes one of their ids
#   scripts/aws.sh rollback [<id>] [frontend|backend]   # the release before the current, or
#                            # <id>; only web, or only the other services, with the rest as is
#   scripts/aws.sh repos     # add the Helm repositories of the cluster components
#
# TLS_ISSUER=letsencrypt-staging scripts/aws.sh up   while DNS-01 is being debugged.
# FORCE=1 scripts/aws.sh down                        without asking about unfinished jobs.
set -euo pipefail
cd "$(dirname "$0")/.."

# Never the default profile: it may belong to another account. CI has the role's
# credentials in the environment instead.
[ -n "${GITHUB_ACTIONS:-}" ] || export AWS_PROFILE=pdp
export AWS_REGION=eu-central-1 AWS_PAGER=''
# Its own kubeconfig, so contexts of other clusters are never touched.
export KUBECONFIG="$HOME/.kube/pdp-aws"
export PATH="$HOME/.local/bin:$PATH"

ACCOUNT=186712718120
CLUSTER=pdp
NS=pdp
DOMAIN=pdp-media-pipeline.online
RDS=pdp
TLS_ISSUER=${TLS_ISSUER:-letsencrypt-prod}
RDS_CA=https://truststore.pki.rds.amazonaws.com/eu-central-1/eu-central-1-bundle.pem

LB_CONTROLLER_VERSION=3.6.0
TRAEFIK_VERSION=42.0.0
CERT_MANAGER_VERSION=v1.21.2
EXTERNAL_DNS_VERSION=1.23.0
METRICS_SERVER_VERSION=3.14.0
KEDA_VERSION=2.21.0

# ECR repositories (deploy/terraform/base/services.tf) and the releases that run them.
SERVICES=(api-gateway metadata scheduler worker video-worker video-dub web audio-separate)
releases_of() {
  case "$1" in
    worker) echo worker-priority worker-cpu worker-io ;;
    video-worker) echo video-frames video-transcode ;;
    *) echo "$1" ;;
  esac
}

need() { command -v "$1" >/dev/null || { echo "missing dependency: $1" >&2; exit 1; }; }
log() { printf '\n==> %s\n' "$*"; }
# The platform chart reads deploy/observability through a symlink; Helm notes it on stderr.
quiet() { "$@" 2> >(grep -v 'symbolic link' >&2); }
tf() { terraform -chdir="deploy/terraform/$1" "${@:2}"; }
# Anything but a Latin y/yes is a no, said out loud: a Cyrillic "у" looks the same.
confirm() {
  local answer
  read -rp "$1 [y/N] " answer
  case "$answer" in
    y | Y | yes | YES) return 0 ;;
    '' | n | N | no | NO)
      echo "not confirmed, nothing changed" >&2
      return 1
      ;;
    *)
      echo "not confirmed ('$answer' is not a Latin y), nothing changed" >&2
      return 1
      ;;
  esac
}
param() { aws ssm get-parameter --name "/pdp/prod/$1" --query Parameter.Value --output text; }
secret_param() {
  aws ssm get-parameter --name "/pdp/prod/$1" --with-decryption --query Parameter.Value --output text
}
# Kubernetes objects from stdin-only sources, so no value reaches a command line.
apply() { kubectl apply -f - >/dev/null; }

identity() {
  local account
  if ! account=$(aws sts get-caller-identity --query Account --output text 2>/dev/null); then
    echo "no AWS session: aws sso login --profile ${AWS_PROFILE:-pdp}" >&2
    exit 1
  fi
  if [ "$account" != "$ACCOUNT" ]; then
    echo "the AWS session is account $account, expected $ACCOUNT" >&2
    exit 1
  fi
}

repos() {
  scripts/k8s.sh repos
  helm repo add eks https://aws.github.io/eks-charts --force-update >/dev/null
  helm repo add traefik https://traefik.github.io/charts --force-update >/dev/null
  helm repo add jetstack https://charts.jetstack.io --force-update >/dev/null
  helm repo add external-dns https://kubernetes-sigs.github.io/external-dns/ --force-update >/dev/null
  helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ --force-update >/dev/null
  helm repo update >/dev/null
}

# The tags of the running release, {"<service>": "<tag>"}, from SSM. By name: the deploy role
# may not read the whole path, the secrets live under it.
deployed_tags() {
  local out svc names=()
  for svc in "${SERVICES[@]}"; do
    names+=("/pdp/prod/deployed-tag/$svc")
  done
  # Checked here: errexit does not reach into a command substitution.
  out=$(aws ssm get-parameters --names "${names[@]}" \
    --query 'Parameters[].[Name,Value]' --output text) || return 1
  jq -Rn '[inputs | split("\t") | {key: (.[0] | split("/") | last), value: .[1]}] | from_entries' \
    <<<"$out"
}

put_tags() {
  local svc
  for svc in "${SERVICES[@]}"; do
    aws ssm put-parameter --name "/pdp/prod/deployed-tag/$svc" --overwrite \
      --value "$(jq -r --arg s "$svc" '.[$s]' <<<"$1")" >/dev/null
  done
}

# A tag for every service, or the names of those without one.
check_tags() {
  local missing
  missing=$(jq -r --args '. as $t | $ARGS.positional[] | select(($t[.] // "none") == "none")' \
    "${SERVICES[@]}" <<<"$1" | tr '\n' ' ')
  [ -z "$missing" ] && return 0
  echo "no image yet for: $missing(CI pushes them from main)" >&2
  return 1
}

# `--set <release>.image.tag=<tag>` for every release of every service.
set_flags() {
  local svc tag release
  while read -r svc tag; do
    for release in $(releases_of "$svc"); do
      printf -- '--set %s.image.tag=%s ' "$release" "$tag"
    done
  done < <(jq -r 'to_entries[] | "\(.key) \(.value)"' <<<"$1")
}

# ECR expires old images (deploy/terraform/base/services.tf): a release is only as good as they.
missing_images() {
  local svc tag
  for svc in "${SERVICES[@]}"; do
    tag=$(jq -r --arg s "$svc" '.[$s]' <<<"$1")
    aws ecr describe-images --repository-name "pdp/$svc" --image-ids imageTag="$tag" \
      >/dev/null 2>&1 || printf '%s:%s ' "$svc" "$tag"
  done
}

# Releases (docs/plan/stage-7.1.md): s3://<bucket>/releases/<id>/ holds manifest.json and
# pdp.tgz, the umbrella chart as it was deployed; current.json is the manifest of the release
# that runs, or that the next `up` deploys. Helm's own history goes with the cluster.
BUCKET=''
releases_bucket() { BUCKET=$(param releases-bucket); }
s3_get() { aws s3 cp --only-show-errors "s3://$BUCKET/$1" "$2"; }
s3_put() { aws s3 cp --only-show-errors "$1" "s3://$BUCKET/$2"; }
# Empty when nothing was released yet.
current_release() { aws s3 cp --only-show-errors "s3://$BUCKET/current.json" - 2>/dev/null || true; }

# The umbrella chart of the working tree with its subcharts, as $1/pdp.tgz and unpacked in $1/pdp.
package_chart() {
  local chart
  for chart in api-gateway metadata scheduler worker video-worker audio-separate web; do
    helm dependency update --skip-refresh "deploy/helm/$chart" >/dev/null
  done
  helm dependency update --skip-refresh deploy/helm/pdp >/dev/null
  helm package deploy/helm/pdp -d "$1" >/dev/null
  mv "$1"/pdp-*.tgz "$1/pdp.tgz"
  tar -xzf "$1/pdp.tgz" -C "$1"
}

release_chart() {
  s3_get "releases/$1/pdp.tgz" "$2/pdp.tgz"
  tar -xzf "$2/pdp.tgz" -C "$2"
}

# What Helm would apply, so a release that changes nothing is not deployed again.
chart_digest() {
  # shellcheck disable=SC2046
  helm template pdp "$1" -n "$NS" -f "$1/values-prod.yaml" -f "$1/values-aws.yaml" \
    $(set_flags "$2") | shasum -a 256 | cut -d' ' -f1
}

# A manifest from stdin with the fields of who made it: id, previous, by, at, run.
stamp() {
  local at sha=$1 previous=$2
  at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq --arg id "${at//[-:]/}-${sha:0:7}" --arg previous "$previous" --arg at "$at" \
    --arg by "${GITHUB_ACTOR:-${USER:-unknown}}" \
    --arg run "${GITHUB_RUN_ID:+$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID}" \
    'def opt: if . == "" then null else . end;
     {id: $id} + del(.id) + {previous: ($previous | opt), at: $at, by: $by, run: ($run | opt)}'
}

# The manifest is the release: the chart and tags it names are what runs once it is current.
make_current() {
  local manifest=$1
  s3_put - current.json <<<"$manifest"
  put_tags "$(jq .tags <<<"$manifest")"
  echo "current release: $(jq -r .id <<<"$manifest")"
}

cluster_state() {
  aws eks describe-cluster --name "$CLUSTER" --query cluster.status --output text 2>/dev/null ||
    echo none
}

rds_state() {
  aws rds describe-db-instances --db-instance-identifier "$RDS" \
    --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo none
}

# The base layer rarely changes, so its plan is shown and confirmed rather than applied blindly.
base() {
  log "base layer"
  tf base init -input=false >/dev/null
  local plan code=0
  plan=$(mktemp)
  tf base plan -input=false -detailed-exitcode -out="$plan" || code=$?
  case "$code" in
    0) ;;
    2)
      confirm "Apply these changes to the base layer?" || exit 1
      tf base apply -input=false "$plan"
      ;;
    *) exit "$code" ;;
  esac
  rm -f "$plan"
}

cluster() {
  log "cluster layer: EKS, nodes, Pod Identity (about 15 minutes)"
  tf cluster init -input=false >/dev/null
  tf cluster apply -input=false -auto-approve
  kubeconfig
  # A fresh access policy takes a few seconds to reach the API server.
  for _ in $(seq 1 24); do
    [ "$(kubectl auth can-i '*' '*' -A 2>/dev/null)" = yes ] && return 0
    sleep 5
  done
  echo "the cluster admin access entry still grants nothing after 2 minutes" >&2
  return 1
}

kubeconfig() {
  mkdir -p "$(dirname "$KUBECONFIG")"
  aws eks update-kubeconfig --name "$CLUSTER" --alias pdp-aws \
    ${AWS_PROFILE:+--profile "$AWS_PROFILE"} >/dev/null
}

components() {
  local vpc zone
  vpc=$(param vpc-id)
  zone=$(param zone-id)
  log "cluster components"
  helm upgrade --install metrics-server metrics-server/metrics-server \
    --version "$METRICS_SERVER_VERSION" -n kube-system --wait
  helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
    --version "$LB_CONTROLLER_VERSION" -n kube-system -f deploy/aws/lb-controller.yaml \
    --set clusterName="$CLUSTER" --set vpcId="$vpc" --wait
  helm upgrade --install cert-manager jetstack/cert-manager --version "$CERT_MANAGER_VERSION" \
    -n cert-manager --create-namespace -f deploy/aws/cert-manager.yaml --wait
  kubectl create namespace traefik --dry-run=client -o yaml | apply
  kubectl create namespace "$NS" --dry-run=client -o yaml | apply
  tls_restore
  helm upgrade --install cluster-aws deploy/helm/cluster-aws -n kube-system \
    --set zoneId="$zone" --set issuer="$TLS_ISSUER" --wait
  helm upgrade --install traefik traefik/traefik --version "$TRAEFIK_VERSION" \
    -n traefik -f deploy/aws/traefik.yaml --wait --timeout 10m
  helm upgrade --install external-dns external-dns/external-dns \
    --version "$EXTERNAL_DNS_VERSION" -n external-dns --create-namespace \
    -f deploy/aws/external-dns.yaml --wait
  helm upgrade --install keda kedacore/keda --version "$KEDA_VERSION" \
    -n keda --create-namespace --wait --timeout 5m
}

# Let's Encrypt issues five certificates for the same names a week, and every `up` is a new
# cluster: the production certificate is kept in SSM between sessions.
tls_restore() {
  [ "$TLS_ISSUER" = letsencrypt-prod ] || return 0
  kubectl -n traefik get secret pdp-tls >/dev/null 2>&1 && return 0
  local crt
  crt=$(param tls-crt 2>/dev/null) || return 0
  log "TLS: the certificate of the last session"
  kubectl -n traefik create secret tls pdp-tls --cert=<(printf '%s\n' "$crt") \
    --key=<(secret_param tls-key) --dry-run=client -o yaml |
    kubectl annotate --local -f - -o yaml cert-manager.io/issuer-name=letsencrypt-prod \
      cert-manager.io/issuer-kind=ClusterIssuer cert-manager.io/issuer-group=cert-manager.io |
    apply
}

tls_save() {
  local issuer crt
  issuer=$(kubectl -n traefik get secret pdp-tls \
    -o jsonpath='{.metadata.annotations.cert-manager\.io/issuer-name}' 2>/dev/null) || return 0
  [ "$issuer" = letsencrypt-prod ] || return 0
  crt=$(kubectl -n traefik get secret pdp-tls -o jsonpath='{.data.tls\.crt}' | base64 -d)
  [ "$crt" = "$(param tls-crt 2>/dev/null || true)" ] && return 0
  log "TLS: keeping the certificate for the next session"
  # The full chain is over the 4 KB of a standard parameter.
  printf '%s\n' "$crt" | aws ssm put-parameter --name /pdp/prod/tls-crt --type String \
    --tier Intelligent-Tiering --overwrite --value file:///dev/stdin >/dev/null &&
    kubectl -n traefik get secret pdp-tls -o jsonpath='{.data.tls\.key}' | base64 -d |
    aws ssm put-parameter --name /pdp/prod/tls-key --type SecureString \
      --overwrite --value file:///dev/stdin >/dev/null ||
    echo "warning: the certificate was not kept, the next up requests a new one" >&2
}

# Secrets from SSM and the RDS CA bundle (DATABASE_URL verifies the server against it).
app_config() {
  log "Secrets and the RDS CA bundle"
  kubectl -n "$NS" create secret generic postgres-app \
    --from-file=uri=<(printf %s "$(secret_param postgres-uri)") --dry-run=client -o yaml | apply
  local key ca
  key=$(secret_param openai-api-key)
  if [ "$key" = unset ]; then
    echo "warning: /pdp/prod/openai-api-key is not set, dubbing will fail" >&2
  fi
  kubectl -n "$NS" create secret generic dub-provider \
    --from-file=openaiApiKey=<(printf %s "$key") --dry-run=client -o yaml | apply
  ca=$(curl -fsS "$RDS_CA")
  kubectl -n "$NS" create configmap rds-ca --from-file=ca.pem=<(printf '%s\n' "$ca") \
    --dry-run=client -o yaml | apply
}

platform() {
  log "platform: Redis, NATS, observability"
  quiet helm dependency build deploy/helm/platform >/dev/null
  quiet helm upgrade --install platform deploy/helm/platform -n "$NS" \
    -f deploy/helm/platform/values-aws.yaml --wait --timeout 10m
}

# The unpacked chart $1 with the tags $2. A failed upgrade rolls back, so the cluster keeps
# serving the previous version.
app() {
  log "app release"
  # shellcheck disable=SC2046
  helm upgrade --install pdp "$1" -n "$NS" -f "$1/values-prod.yaml" -f "$1/values-aws.yaml" \
    $(set_flags "$2") --rollback-on-failure --timeout 15m
}

# The release $2 with its chart unpacked in $1. It becomes current only once it runs, so a
# failed upgrade is tried again by the next deploy.
roll_out() {
  if [ "$(cluster_state)" = ACTIVE ]; then
    kubeconfig
    app "$1" "$(jq .tags <<<"$2")"
  else
    echo "the cluster is off; the next up deploys this release"
  fi
  make_current "$2"
}

publish() {
  local id
  id=$(jq -r .id <<<"$2")
  s3_put "$1/pdp.tgz" "releases/$id/pdp.tgz"
  s3_put "$1/notes.md" "releases/$id/notes.md"
  s3_put - "releases/$id/manifest.json" <<<"$2"
}

# The services whose tag in $2 differs from $1, both {"<service>": "<tag>"}; $1 may be empty.
changed_images() {
  jq -r --argjson old "${1:-null}" \
    'to_entries | map(select(($old // {})[.key] != .value) | .key) | join(" ")' <<<"$2"
}

# The GitHub release of a release that runs, so its notes sit next to the code. Without gh the
# notes stay in S3 alone.
github_release() {
  local tag=$1 sha=$2 title=$3 notes=$4
  shift 4
  if ! command -v gh >/dev/null || ! gh auth status >/dev/null 2>&1; then
    echo "warning: gh is missing or signed out, so no GitHub release $tag" >&2
    return 0
  fi
  gh release create "$tag" --target "$sha" --title "$title" --notes-file "$notes" "$@" >/dev/null
  echo "GitHub release $tag"
}

# CI after pushing the images, TAGS={"<service>": "<tag>"} of the commit: the platform and the
# components stay as `up` left them.
release() {
  identity
  releases_bucket
  local tags=${TAGS:-} sha dir digest current manifest id notes version
  [ -n "$tags" ] || tags=$(deployed_tags)
  # The services of ECR in their order, so the same tags always render the same chart.
  tags=$(jq -c --args '. as $t | $ARGS.positional | map({(.): $t[.]}) | add' \
    "${SERVICES[@]}" <<<"$tags")
  check_tags "$tags"
  if ! git diff --quiet HEAD -- deploy/helm; then
    echo "deploy/helm has uncommitted changes, and a release is a commit" >&2
    return 1
  fi
  sha=$(git rev-parse HEAD)
  dir=$(mktemp -d)
  package_chart "$dir"
  digest=$(chart_digest "$dir/pdp" "$tags")
  current=$(current_release)
  if [ "$(jq -r .chart <<<"$current")" = "$digest" ]; then
    echo "nothing to deploy: release $(jq -r .id <<<"$current") has the same chart and images"
    return 0
  fi
  manifest=$(jq -n --arg sha "$sha" --argjson tags "$tags" --arg chart "$digest" \
    '{kind: "deploy", sha: $sha, tags: $tags, chart: $chart}' |
    stamp "$sha" "$(jq -r '.id // ""' <<<"$current")")
  id=$(jq -r .id <<<"$manifest")
  # The version follows the highest tag, which a clone made before it was released lacks.
  git fetch -q --tags origin 2>/dev/null || true
  # The commits since the current release: those no deploy went out with are in this one.
  notes=$(node scripts/release-notes.mjs --from "$(jq -r '.sha // ""' <<<"$current")" \
    --to "$sha" --release "$id" --images "$(changed_images "$(jq .tags <<<"$current")" "$tags")")
  version=$(jq -r .version <<<"$notes")
  jq -r .notes <<<"$notes" >"$dir/notes.md"
  manifest=$(jq --arg version "$version" '. + {version: $version}' <<<"$manifest")
  log "release $version ($id)"
  jq . <<<"$manifest"
  cat "$dir/notes.md"
  publish "$dir" "$manifest"
  roll_out "$dir/pdp" "$manifest"
  github_release "$version" "$sha" "$version" "$dir/notes.md" --latest
}

# The services a partial rollback takes from the earlier release.
scope_services() {
  local svc
  for svc in "${SERVICES[@]}"; do
    case "$1" in
      frontend) [ "$svc" = web ] && echo "$svc" ;;
      backend) [ "$svc" != web ] && echo "$svc" ;;
    esac
  done
}

# Release <id>, or the one before the current, again, while ECR still has its images: all of it,
# or only the images of the frontend or the backend over the current chart and the other images.
# Recorded as a new release of kind rollback, so the history stays in order; the next push to
# main deploys the head again.
rollback() {
  identity
  releases_bucket
  local arg id='' scope=all current target base tags dir digest what missing manifest new title
  local from run images
  for arg in "$@"; do
    case "$arg" in
      all | frontend | backend) scope=$arg ;;
      '') ;;
      *) id=$arg ;;
    esac
  done
  current=$(current_release)
  id=${id:-$(jq -r '.previous // ""' <<<"$current")}
  if [ -z "$id" ]; then
    echo "no release before the current one; scripts/aws.sh releases lists them" >&2
    return 1
  fi
  if ! target=$(aws s3 cp --only-show-errors "s3://$BUCKET/releases/$id/manifest.json" - \
    2>/dev/null); then
    echo "no release $id; scripts/aws.sh releases lists them" >&2
    return 1
  fi
  if [ "$scope" = all ]; then
    base=$target
    tags=$(jq -c .tags <<<"$target")
  elif [ -z "$current" ]; then
    echo "a $scope rollback keeps the rest of the current release, and there is none yet" >&2
    return 1
  else
    base=$current
    # shellcheck disable=SC2046
    tags=$(jq -c --argjson from "$(jq .tags <<<"$target")" \
      '.tags as $t | reduce $ARGS.positional[] as $s ($t; .[$s] = $from[$s])' \
      --args $(scope_services "$scope") <<<"$current")
  fi
  dir=$(mktemp -d)
  release_chart "$(jq -r .id <<<"$base")" "$dir"
  digest=$(chart_digest "$dir/pdp" "$tags")
  what="release $id"
  [ "$scope" = all ] || what="the $scope of $what"
  if [ "$digest" = "$(jq -r .chart <<<"$current")" ]; then
    echo "nothing to roll back: $what is what runs already"
    return 0
  fi
  missing=$(missing_images "$tags")
  if [ -n "$missing" ]; then
    echo "ECR no longer has the images of release $id: ${missing% }; nothing changed" >&2
    return 1
  fi
  if [ -z "${GITHUB_ACTIONS:-}" ]; then
    confirm "Roll back to $what, now $(jq -r '.id // "nothing"' <<<"$current") runs?" || exit 1
  fi
  manifest=$(jq --arg of "$id" --arg scope "$scope" --argjson tags "$tags" --arg chart "$digest" \
    '. + {kind: "rollback", of: $of, scope: $scope, tags: $tags, chart: $chart}' <<<"$base" |
    stamp "$(jq -r .sha <<<"$base")" "$(jq -r '.id // ""' <<<"$current")")
  new=$(jq -r .id <<<"$manifest")
  log "rollback to $what as release $new"
  title="Rollback to $(jq -r '.version // .id' <<<"$target")"
  [ "$scope" = all ] || title="Rollback of the $scope to $(jq -r '.version // .id' <<<"$target")"
  from=$(jq -r '.version // .id' <<<"$current")
  run=$(jq -r '.run // ""' <<<"$manifest")
  images=$(changed_images "$(jq .tags <<<"$current")" "$tags")
  {
    echo "$title, until the next push to main deploys the head again."
    echo
    echo "- From: ${from:-nothing}"
    echo "- Images: ${images:-none changed}"
    echo "- Release: \`$new\`, of \`$id\`"
    [ -z "$run" ] || echo "- Run: $run"
  } >"$dir/notes.md"
  publish "$dir" "$manifest"
  roll_out "$dir/pdp" "$manifest"
  github_release "rollback-$new" "$(jq -r .sha <<<"$manifest")" "$title" "$dir/notes.md" \
    --latest=false
}

# The last $1 releases, newest first; * marks the current one.
releases() {
  identity
  releases_bucket
  local current prefixes prefix id
  current=$(jq -r .id <<<"$(current_release)")
  prefixes=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix releases/ --delimiter / \
    --query 'CommonPrefixes[].Prefix' --output text)
  if [ "$prefixes" = None ]; then
    echo "no releases yet"
    return 0
  fi
  for prefix in $(tr '\t' '\n' <<<"$prefixes" | sort -r | head -n "${1:-10}"); do
    id=${prefix#releases/}
    id=${id%/}
    printf '%s %s\t' "$([ "$id" = "$current" ] && echo '*' || echo ' ')" "$id"
    s3_get "${prefix}manifest.json" - |
      jq -r '[.version // "-", .kind, .sha[:7], .by, (if .of then "of " + .of else "" end),
              (if (.scope // "all") != "all" then "(" + .scope + ")" else "" end)] | join("\t")'
  done
}

up() {
  identity
  local current tags missing dir
  dir=$(mktemp -d)
  # Missing until the base layer has it, and then until CI records the first release.
  BUCKET=$(param releases-bucket 2>/dev/null) || true
  current=$(current_release)
  if [ -n "$current" ]; then
    tags=$(jq .tags <<<"$current")
    missing=$(missing_images "$tags")
    if [ -n "$missing" ]; then
      echo "ECR no longer has: ${missing% }; scripts/aws.sh rollback <id>, or a push to main" >&2
      exit 1
    fi
    log "release $(jq -r .id <<<"$current")"
    release_chart "$(jq -r .id <<<"$current")" "$dir"
  else
    tags=$(deployed_tags)
    check_tags "$tags"
    package_chart "$dir"
  fi
  if [ "$(rds_state)" = stopped ]; then
    log "starting RDS"
    aws rds start-db-instance --db-instance-identifier "$RDS" >/dev/null
  fi
  base
  cluster
  log "waiting for RDS"
  aws rds wait db-instance-available --db-instance-identifier "$RDS"
  components
  app_config
  platform
  app "$dir/pdp" "$tags"
  smoke_user
  log "certificate ($TLS_ISSUER)"
  kubectl -n traefik wait certificate/pdp-tls --for=condition=Ready --timeout=10m ||
    echo "not ready yet: kubectl -n traefik describe certificate pdp-tls" >&2
  urls
}

# `select count(*)::int as n ...` in RDS, through the metadata pod; the rest are its $1, $2...
count_of() {
  kubectl -n "$NS" exec deploy/metadata -- node -e '
    const { Client } = require("pg");
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    c.connect()
      .then(() => c.query(process.argv[1], process.argv.slice(2)))
      .then((r) => { console.log(r.rows[0].n); return c.end(); });
  ' "$@" 2>/dev/null || echo unknown
}

# NATS and its volume go with the cluster, so jobs still in flight would never finish.
active_jobs() {
  # shellcheck disable=SC2016
  count_of 'select count(*)::int as n from jobs where status not in ($1, $2)' succeeded dead
}

# The user of scripts/smoke.sh in CI. Once: it lives in RDS, which outlives the cluster.
smoke_user() {
  local n
  # shellcheck disable=SC2016
  n=$(count_of 'select count(*)::int as n from users where name = $1' smoke)
  if [ "$n" = unknown ]; then
    echo "warning: no smoke user check; later: scripts/aws.sh seed smoke" >&2
    return 0
  fi
  [ "$n" = 0 ] || return 0
  log "smoke user"
  echo "its key, shown once: the secret SMOKE_API_KEY of the GitHub environment aws"
  seed smoke | jq -r .apiKey
}

down() {
  identity
  if [ "$(cluster_state)" != none ]; then
    kubeconfig
    local jobs
    jobs=$(active_jobs)
    if [ "$jobs" != 0 ] && [ "${FORCE:-}" != 1 ]; then
      echo "unfinished jobs: $jobs; they stay unfinished, NATS goes with the cluster" >&2
      confirm "Destroy the cluster anyway?" || exit 1
    fi
    tls_save
    # PVCs of StatefulSets outlive their release; the EBS volumes go with them.
    log "removing the app and its volumes"
    helm uninstall pdp -n "$NS" --wait --ignore-not-found
    helm uninstall platform -n "$NS" --wait --ignore-not-found
    kubectl -n "$NS" delete pvc --all --wait
    if kubectl get pv -o name | grep -q .; then
      kubectl wait --for=delete pv --all --timeout=5m
    fi
    # Once its TXT records are gone, external-dns no longer owns what is left.
    log "waiting for external-dns to remove the records"
    for _ in $(seq 1 18); do
      [ -z "$(nlb_records)" ] && break
      sleep 10
    done
    # The Service keeps a finalizer until the controller has removed the NLB, its target
    # groups and security groups.
    log "removing Traefik and its NLB"
    helm uninstall traefik -n traefik --wait --ignore-not-found --timeout 10m
    log "cluster layer"
    tf cluster init -input=false >/dev/null
    tf cluster destroy -input=false -auto-approve
  fi
  if [ "$(rds_state)" = available ]; then
    log "stopping RDS"
    aws rds stop-db-instance --db-instance-identifier "$RDS" >/dev/null
  fi
  leftovers
}

nlb_records() {
  aws route53 list-resource-record-sets --hosted-zone-id "$(param zone-id)" \
    --query "ResourceRecordSets[?contains(AliasTarget.DNSName || '', 'k8s-traefik')].[Type,Name]" \
    --output text
}

leftovers() {
  local lbs volumes records
  lbs=$(aws resourcegroupstaggingapi get-resources \
    --resource-type-filters elasticloadbalancing:loadbalancer \
    --tag-filters "Key=elbv2.k8s.aws/cluster,Values=$CLUSTER" \
    --query 'ResourceTagMappingList[].ResourceARN' --output text)
  volumes=$(aws ec2 describe-volumes \
    --filters Name=tag:Project,Values=pdp-media-pipeline Name=tag:Layer,Values=cluster \
    --query 'Volumes[].VolumeId' --output text)
  [ -z "$lbs" ] || echo "load balancers still billed: $lbs" >&2
  [ -z "$volumes" ] || echo "EBS volumes still billed: $volumes" >&2
  records=$(nlb_records | tr '\t\n' ' ;')
  [ -z "$records" ] || echo "records of the removed NLB, delete them in Route 53: $records" >&2
}

urls() {
  echo
  printf '%-8s https://%s\n' app "app.$DOMAIN" api "api.$DOMAIN" redirect "$DOMAIN"
  printf '%-8s scripts/aws.sh grafana\n' grafana
}

status() {
  identity
  local state rds stopped current
  state=$(cluster_state)
  rds=$(rds_state)
  BUCKET=$(param releases-bucket 2>/dev/null) || true
  current=$(jq -r '"\(.id) (\(.kind))"' <<<"$(current_release)")
  printf '%-8s %s\n' cluster "$state" rds "$rds" release "${current:-none}"
  if [ "$rds" = stopped ]; then
    # shellcheck disable=SC2016
    stopped=$(aws rds describe-events --source-type db-instance --source-identifier "$RDS" \
      --duration 10080 --query 'Events[?contains(Message, `stopped`)] | [-1].Date' --output text)
    echo "         stopped at $stopped; AWS starts it again 7 days later"
  fi
  if [ "$state" = ACTIVE ]; then
    kubeconfig
    echo
    kubectl get nodes
    echo
    kubectl -n "$NS" get pods
    urls
    echo
    echo "cost: about \$0.67 an hour while the cluster runs"
  elif [ "$rds" = none ]; then
    echo "cost: about \$1-2 a month (the zone, ECR, state)"
  else
    echo "cost: about \$4-5 a month (RDS storage, the zone, ECR)"
  fi
  leftovers
}

grafana() {
  kubeconfig
  echo "Grafana on http://localhost:3000 (Ctrl-C to stop)"
  kubectl -n "$NS" port-forward svc/grafana 3000:80
}

seed() {
  kubeconfig
  kubectl -n "$NS" exec deploy/metadata -- node dist/seed-user.js --name "${1:-me}"
}

need helm
case "${1:-}" in
  up | down)
    need aws
    need terraform
    need kubectl
    need curl
    need jq
    ;;
  status | grafana | seed | release | releases | rollback)
    need aws
    need kubectl
    need jq
    [ "$1" != release ] || need node
    ;;
esac

case "${1:-}" in
  repos) repos ;;
  up)
    repos
    up
    ;;
  down) down ;;
  status) status ;;
  grafana) grafana ;;
  seed) seed "${2:-me}" ;;
  release) release ;;
  releases) releases ;;
  rollback) rollback "${@:2}" ;;
  *)
    sed -n '2,16p' "$0"
    exit 1
    ;;
esac
