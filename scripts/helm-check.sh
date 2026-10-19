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

scripts/aws.sh repos
quiet helm dependency build deploy/helm/platform >/dev/null
for chart in deploy/helm/*/; do
  [ "$chart" = deploy/helm/platform/ ] && continue
  if grep -q '^dependencies:' "$chart/Chart.yaml"; then
    helm dependency update --skip-refresh "$chart" >/dev/null
  fi
done

for chart in deploy/helm/*/; do
  # cluster-aws refuses to render without the zone that aws.sh reads from SSM.
  quiet helm lint --quiet "$chart" --set zoneId=check
done

quiet helm template platform deploy/helm/platform -n pdp >"$OUT/platform.yaml"
quiet helm template platform deploy/helm/platform -n pdp \
  -f deploy/helm/platform/values-aws.yaml >"$OUT/platform-aws.yaml"
for env in dev prod; do
  helm template pdp deploy/helm/pdp -n pdp -f "deploy/helm/pdp/values-$env.yaml" \
    --set global.image.tag=check >"$OUT/pdp-$env.yaml"
done
helm template pdp deploy/helm/pdp -n pdp -f deploy/helm/pdp/values-prod.yaml \
  -f deploy/helm/pdp/values-aws.yaml --set global.image.tag=check >"$OUT/pdp-aws.yaml"
helm template cluster-aws deploy/helm/cluster-aws -n kube-system --set zoneId=check \
  >"$OUT/cluster-aws.yaml"

# The values of the EKS components against their charts' schemas, at the versions aws.sh
# installs; their own manifests are not validated here.
version_of() { sed -n "s/^$1=//p" scripts/aws.sh; }
helm template traefik traefik/traefik --version "$(version_of TRAEFIK_VERSION)" -n traefik \
  -f deploy/aws/traefik.yaml >/dev/null
helm template aws-load-balancer-controller eks/aws-load-balancer-controller \
  --version "$(version_of LB_CONTROLLER_VERSION)" -n kube-system -f deploy/aws/lb-controller.yaml \
  --set clusterName=check --set vpcId=check >/dev/null
helm template cert-manager jetstack/cert-manager --version "$(version_of CERT_MANAGER_VERSION)" \
  -n cert-manager -f deploy/aws/cert-manager.yaml >/dev/null
helm template external-dns external-dns/external-dns \
  --version "$(version_of EXTERNAL_DNS_VERSION)" -n external-dns \
  -f deploy/aws/external-dns.yaml >/dev/null

# In AWS nothing may still point at MinIO or its keys, and the two pods under a
# NetworkPolicy that call AWS must reach the Pod Identity agent.
if grep -qE 'minio|s3-credentials' "$OUT/pdp-aws.yaml" "$OUT/platform-aws.yaml"; then
  echo 'AWS profile still refers to MinIO' >&2
  exit 1
fi
if [ "$(grep -c '169.254.170.23/32' "$OUT/pdp-aws.yaml")" -ne 2 ]; then
  echo 'AWS profile: video-dub and audio-separate need egressPodIdentity' >&2
  exit 1
fi

docker run --rm -v "$OUT:/manifests:ro" "$KUBECONFORM_IMAGE" \
  -strict -summary -kubernetes-version "$KUBERNETES_VERSION" \
  -schema-location default -schema-location "$CRDS" \
  /manifests
