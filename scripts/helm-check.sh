#!/usr/bin/env bash
# Lints every chart and validates the rendered manifests against the Kubernetes schemas
# (kubeconform, CRDs from the datreeio catalog). Used by CI and `pnpm helm:lint`.
set -euo pipefail
cd "$(dirname "$0")/.."

KUBECONFORM_IMAGE=ghcr.io/yannh/kubeconform:v0.8.0
KUBERNETES_VERSION=1.35.0
CRDS='https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

# The platform chart reads deploy/observability through a symlink; Helm notes it on stderr.
quiet() { "$@" 2> >(grep -v 'symbolic link' >&2); }

scripts/k8s.sh repos
quiet helm dependency build deploy/helm/platform >/dev/null
for chart in deploy/helm/*/; do
  [ "$chart" = deploy/helm/platform/ ] && continue
  if grep -q '^dependencies:' "$chart/Chart.yaml"; then
    helm dependency update --skip-refresh "$chart" >/dev/null
  fi
done

for chart in deploy/helm/*/; do
  quiet helm lint --quiet "$chart"
done

quiet helm template platform deploy/helm/platform -n pdp >"$OUT/platform.yaml"
for env in dev prod; do
  helm template pdp deploy/helm/pdp -n pdp -f "deploy/helm/pdp/values-$env.yaml" \
    --set global.image.tag=check >"$OUT/pdp-$env.yaml"
done

docker run --rm -v "$OUT:/manifests:ro" "$KUBECONFORM_IMAGE" \
  -strict -summary -kubernetes-version "$KUBERNETES_VERSION" \
  -schema-location default -schema-location "$CRDS" \
  /manifests
