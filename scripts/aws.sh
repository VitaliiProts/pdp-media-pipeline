#!/usr/bin/env bash
# Stage 5b: the app on EKS (docs/plan/stage-5b.md, ADR-017). Billed by the hour while up.
#
#   scripts/aws.sh up        # base and cluster layers, RDS on, cluster components, the app
#   scripts/aws.sh down      # the app with its volumes, the NLB, the cluster layer; RDS off
#   scripts/aws.sh status    # what runs, what is left behind, what it costs
#   scripts/aws.sh grafana   # Grafana on http://localhost:3000
#   scripts/aws.sh seed me   # create a user, print its API key
#   scripts/aws.sh release   # the app release only, with the tags in SSM (CI after a push)
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

# `--set <release>.image.tag=<tag>` for every release, from the tags CI wrote to SSM. By name:
# the deploy role may not read the whole path, the secrets live under it.
image_tags() {
  local out name tag svc release missing='' names=()
  for svc in "${SERVICES[@]}"; do
    names+=("/pdp/prod/deployed-tag/$svc")
  done
  # Checked here: errexit does not reach into a command substitution.
  out=$(aws ssm get-parameters --names "${names[@]}" \
    --query 'Parameters[].[Name,Value]' --output text) || return 1
  if [ "$(printf '%s\n' "$out" | grep -c .)" -ne ${#SERVICES[@]} ]; then
    echo "SSM has no tag for some of: ${SERVICES[*]}" >&2
    return 1
  fi
  while read -r name tag; do
    svc=${name##*/}
    if [ "$tag" = none ]; then
      missing="$missing $svc"
      continue
    fi
    for release in $(releases_of "$svc"); do
      printf -- '--set %s.image.tag=%s ' "$release" "$tag"
    done
  done <<<"$out"
  if [ -n "$missing" ]; then
    echo "no image in ECR yet for:$missing (CI pushes them from main)" >&2
    return 1
  fi
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
  local i
  for i in $(seq 1 24); do
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

# A failed upgrade rolls back, so the cluster keeps serving the previous version.
app() {
  log "app release"
  local chart
  for chart in api-gateway metadata scheduler worker video-worker audio-separate web; do
    helm dependency update --skip-refresh "deploy/helm/$chart" >/dev/null
  done
  helm dependency update --skip-refresh deploy/helm/pdp >/dev/null
  # shellcheck disable=SC2086
  helm upgrade --install pdp deploy/helm/pdp -n "$NS" -f deploy/helm/pdp/values-prod.yaml \
    -f deploy/helm/pdp/values-aws.yaml $1 --rollback-on-failure --timeout 15m
}

# CI after pushing the images: the platform and the components stay as `up` left them.
release() {
  identity
  local tags
  tags=$(image_tags)
  if [ "$(cluster_state)" != ACTIVE ]; then
    echo "the cluster is off; the images are in ECR and the next up deploys them"
    return 0
  fi
  kubeconfig
  app "$tags"
}

up() {
  identity
  local tags
  tags=$(image_tags)
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
  app "$tags"
  log "certificate ($TLS_ISSUER)"
  kubectl -n traefik wait certificate/pdp-tls --for=condition=Ready --timeout=10m ||
    echo "not ready yet: kubectl -n traefik describe certificate pdp-tls" >&2
  urls
}

# NATS and its volume go with the cluster, so jobs still in flight would never finish.
active_jobs() {
  # shellcheck disable=SC2016
  kubectl -n "$NS" exec deploy/metadata -- node -e '
    const { Client } = require("pg");
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    c.connect()
      .then(() => c.query("select count(*)::int as n from jobs where status not in ($1, $2)",
        ["succeeded", "dead"]))
      .then((r) => { console.log(r.rows[0].n); return c.end(); });
  ' 2>/dev/null || echo unknown
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
    local i
    for i in $(seq 1 18); do
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
  local state rds stopped
  state=$(cluster_state)
  rds=$(rds_state)
  printf '%-8s %s\n' cluster "$state" rds "$rds"
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
    ;;
  status | grafana | seed | release)
    need aws
    need kubectl
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
  *)
    sed -n '2,13p' "$0"
    exit 1
    ;;
esac
