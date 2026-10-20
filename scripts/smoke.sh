#!/usr/bin/env bash
# The deployed app from outside, as a client sees it (Stage 5b.3, docs/plan/stage-5b.md):
# readiness, one real image.resize job end to end, its asset in the media library.
#
#   SMOKE_API_KEY=... scripts/smoke.sh https://api.pdp-media-pipeline.online
#
# The key belongs to the user `scripts/aws.sh up` creates once. No dub here: it is paid and
# its pods start from zero.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:?usage: scripts/smoke.sh <base-url>}"
BASE="${BASE%/}"
: "${SMOKE_API_KEY:?SMOKE_API_KEY is required}"
TIMEOUT_S="${TIMEOUT_S:-120}"
IMAGE=perf/k6/fixtures/source.png

need() { command -v "$1" >/dev/null || { echo "missing dependency: $1" >&2; exit 1; }; }
need curl
need jq

api() {
  curl -sS --fail-with-body --max-time 20 -H "x-api-key: $SMOKE_API_KEY" \
    -H 'content-type: application/json' "$@"
}

ready="$(curl -sS --fail-with-body --max-time 20 "$BASE/health/ready")"
echo "ready:  $(jq -c '.info | keys' <<<"$ready")"

size="$(wc -c <"$IMAGE" | tr -d ' ')"
upload="$(api -X POST "$BASE/v1/uploads" -d "{\"contentType\":\"image/png\",\"size\":$size}")"
curl -sS --fail-with-body --max-time 60 -X PUT -H 'content-type: image/png' \
  --data-binary "@$IMAGE" "$(jq -r .uploadUrl <<<"$upload")" >/dev/null
source_key="$(jq -r .sourceKey <<<"$upload")"
asset_id="$(jq -r .assetId <<<"$upload")"
echo "upload: $source_key"

job_id="$(api -X POST "$BASE/v1/jobs" \
  -d "{\"type\":\"image.resize\",\"sourceKey\":\"$source_key\",\"presets\":[\"thumb\"]}" |
  jq -r .jobId)"
echo "job:    $job_id"

deadline=$((SECONDS + TIMEOUT_S))
status=""
while ((SECONDS < deadline)); do
  job="$(api "$BASE/v1/jobs/$job_id")"
  new_status="$(jq -r .status <<<"$job")"
  [[ "$new_status" != "$status" ]] && echo "status: $new_status" && status="$new_status"
  case "$status" in
    succeeded) break ;;
    failed | dead) echo "job failed: $(jq -r .lastError <<<"$job")" >&2; exit 1 ;;
  esac
  sleep 2
done
[[ "$status" == succeeded ]] || { echo "timed out after ${TIMEOUT_S}s in status $status" >&2; exit 1; }

read -r preset bytes url < <(jq -r '.results[0] | "\(.preset) \(.bytes) \(.url)"' <<<"$job")
got="$(curl -sS --fail --max-time 30 -o /dev/null -w '%{size_download}' "$url")"
[[ "$got" == "$bytes" ]] || { echo "$preset: downloaded $got bytes, expected $bytes" >&2; exit 1; }
echo "result: $preset $bytes bytes"

asset="$(api "$BASE/v1/assets/$asset_id")"
jq -e --arg job "$job_id" 'any(.jobs[]; .id == $job)' <<<"$asset" >/dev/null ||
  { echo "asset $asset_id does not list job $job_id" >&2; exit 1; }
echo "asset:  $asset_id"
echo "OK"
