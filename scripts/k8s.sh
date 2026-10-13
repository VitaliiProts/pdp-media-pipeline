#!/usr/bin/env bash
# Stage 5 local Kubernetes: a k3d cluster with the platform and the app (docs/plan/stage-5.md).
#
#   scripts/k8s.sh up        # cluster, operators, platform, images and the app
#   scripts/k8s.sh deploy    # rebuild images and upgrade the app release only
#   scripts/k8s.sh seed me   # create a user, print its API key
#   scripts/k8s.sh status    # pods and URLs
#   scripts/k8s.sh down      # delete the cluster with its registry and volumes
#   scripts/k8s.sh repos     # add the Helm repositories of the platform chart
#
# Images are tagged with their content ID, so `deploy` rolls only the services whose
# image changed, and a node never runs a stale image cached under the same tag.
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER=pdp
NS=pdp
REGISTRY=localhost:5001
INGRESS=http://%s.pdp.localhost:19080
CNPG_VERSION=0.29.1
KEDA_VERSION=2.21.0
APPS=(api-gateway metadata scheduler worker video-worker webhook-receiver web)
SERVICE_CHARTS=(api-gateway metadata scheduler worker video-worker webhook-receiver web)
# Deployments built from one image (aliases in deploy/helm/pdp/Chart.yaml).
releases_of() {
  case "$1" in
    worker) echo worker-priority worker-cpu worker-io ;;
    video-worker) echo video-frames video-transcode ;;
    *) echo "$1" ;;
  esac
}

need() { command -v "$1" >/dev/null || { echo "missing dependency: $1" >&2; exit 1; }; }
log() { printf '\n==> %s\n' "$*"; }

repos() {
  helm repo add cnpg https://cloudnative-pg.github.io/charts --force-update >/dev/null
  helm repo add kedacore https://kedacore.github.io/charts --force-update >/dev/null
  helm repo add nats https://nats-io.github.io/k8s/helm/charts/ --force-update >/dev/null
  helm repo add vm https://victoriametrics.github.io/helm-charts/ --force-update >/dev/null
  helm repo add grafana-community https://grafana-community.github.io/helm-charts --force-update >/dev/null
  helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts --force-update >/dev/null
  helm repo update >/dev/null
}

cluster() {
  if ! k3d cluster get "$CLUSTER" >/dev/null 2>&1; then
    log "creating k3d cluster $CLUSTER"
    k3d cluster create --config deploy/k3d/cluster.yaml
  fi
  kubectl config use-context "k3d-$CLUSTER" >/dev/null
}

operators() {
  log "operators: CloudNativePG $CNPG_VERSION, KEDA $KEDA_VERSION"
  helm upgrade --install cnpg cnpg/cloudnative-pg --version "$CNPG_VERSION" \
    -n cnpg-system --create-namespace --wait --timeout 5m
  helm upgrade --install keda kedacore/keda --version "$KEDA_VERSION" \
    -n keda --create-namespace --wait --timeout 5m
}

platform() {
  log "platform: Postgres, Redis, NATS, MinIO, observability"
  helm dependency build deploy/helm/platform >/dev/null
  helm upgrade --install platform deploy/helm/platform -n "$NS" --create-namespace \
    --wait --timeout 10m 2>&1 | grep -v 'symbolic link'
  kubectl -n "$NS" wait cluster/postgres --for=condition=Ready --timeout=5m
}

# Builds through docker-compose (same Dockerfiles and cache) and pushes to the k3d registry.
# Prints `--set <app>.image.tag=<id>` arguments for helm.
images() {
  log "building images" >&2
  docker compose build metadata-migrate api-gateway scheduler worker video-worker \
    webhook-receiver web >&2
  local app id release
  for app in "${APPS[@]}"; do
    id=$(docker image inspect --format '{{.Id}}' "pdp/$app:dev" | cut -d: -f2 | cut -c1-12)
    docker tag "pdp/$app:dev" "$REGISTRY/pdp/$app:$id"
    docker push --quiet "$REGISTRY/pdp/$app:$id" >/dev/null
    for release in $(releases_of "$app"); do
      printf -- '--set %s.image.tag=%s ' "$release" "$id"
    done
  done
}

app() {
  local tags
  tags=$(images)
  log "app release"
  local chart
  for chart in "${SERVICE_CHARTS[@]}"; do
    helm dependency update --skip-refresh "deploy/helm/$chart" >/dev/null
  done
  helm dependency update --skip-refresh deploy/helm/pdp >/dev/null
  # shellcheck disable=SC2086
  helm upgrade --install pdp deploy/helm/pdp -n "$NS" -f deploy/helm/pdp/values-dev.yaml \
    $tags --wait --timeout 10m
}

seed() {
  kubectl -n "$NS" exec deploy/metadata -- node dist/seed-user.js --name "${1:-me}"
}

status() {
  kubectl -n "$NS" get pods -o wide
  echo
  for host in app api grafana vm s3 minio; do
    # shellcheck disable=SC2059
    printf "%-8s $INGRESS\n" "$host" "$host"
  done
}

need helm
case "${1:-}" in
  repos) ;;
  *)
    need k3d
    need kubectl
    need docker
    ;;
esac

case "${1:-}" in
  repos) repos ;;
  up)
    repos
    cluster
    operators
    platform
    app
    status
    ;;
  deploy)
    kubectl config use-context "k3d-$CLUSTER" >/dev/null
    app
    ;;
  seed) seed "${2:-me}" ;;
  status) status ;;
  down) k3d cluster delete "$CLUSTER" ;;
  *)
    sed -n '2,10p' "$0"
    exit 1
    ;;
esac
