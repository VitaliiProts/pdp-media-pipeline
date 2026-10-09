#!/usr/bin/env bash
# End-to-end check of the Stage 1 flow against a running `docker compose up` stack:
# seed user -> presigned upload -> POST /v1/jobs -> poll until succeeded -> fetch results.
set -euo pipefail

GATEWAY="${GATEWAY:-http://localhost:${GATEWAY_HOST_PORT:-18080}}"
TIMEOUT_S="${TIMEOUT_S:-60}"
IMAGE="${1:-}"

need() { command -v "$1" >/dev/null || { echo "missing dependency: $1" >&2; exit 1; }; }
need curl
need jq
need docker

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [[ -z "$IMAGE" ]]; then
  IMAGE="$tmp/source.png"
  # 1200x800 PNG generated with the sharp already present in the worker image.
  docker compose exec -T worker node -e "
    require('sharp')({ create: { width: 1200, height: 800, channels: 3, background: '#2a7ae2' } })
      .png().toBuffer().then((b) => process.stdout.write(b));
  " >"$IMAGE"
fi
size="$(wc -c <"$IMAGE" | tr -d ' ')"
echo "source: $IMAGE ($size bytes)"

seed="$(docker compose exec -T metadata node dist/seed-user.js --name "smoke-$(date +%s)")"
api_key="$(jq -r .apiKey <<<"$seed")"
echo "user:   $(jq -r .userId <<<"$seed")"

api() { curl -sS --fail-with-body -H "x-api-key: $api_key" -H 'content-type: application/json' "$@"; }

upload="$(api -X POST "$GATEWAY/v1/uploads" -d "{\"contentType\":\"image/png\",\"size\":$size}")"
curl -sS --fail-with-body -X PUT -H 'content-type: image/png' --data-binary "@$IMAGE" \
  "$(jq -r .uploadUrl <<<"$upload")" >/dev/null
source_key="$(jq -r .sourceKey <<<"$upload")"
echo "upload: $source_key"

job_id="$(api -X POST "$GATEWAY/v1/jobs" \
  -d "{\"type\":\"image.resize\",\"sourceKey\":\"$source_key\",\"presets\":[\"thumb\",\"medium\",\"large\"]}" |
  jq -r .jobId)"
echo "job:    $job_id"

deadline=$((SECONDS + TIMEOUT_S))
status=""
while ((SECONDS < deadline)); do
  job="$(api "$GATEWAY/v1/jobs/$job_id")"
  new_status="$(jq -r .status <<<"$job")"
  [[ "$new_status" != "$status" ]] && echo "status: $new_status" && status="$new_status"
  case "$status" in
    succeeded) break ;;
    failed | dead) echo "job failed: $(jq -r .lastError <<<"$job")" >&2; exit 1 ;;
  esac
  sleep 0.5
done
[[ "$status" == succeeded ]] || { echo "timed out after ${TIMEOUT_S}s in status $status" >&2; exit 1; }

jq -r '.results[] | "\(.preset)\t\(.width)x\(.height)\t\(.bytes)\t\(.url)"' <<<"$job" |
  while IFS=$'\t' read -r preset dims bytes url; do
    got="$(curl -sS --fail -o "$tmp/$preset.webp" -w '%{size_download}' "$url")"
    [[ "$got" == "$bytes" ]] || { echo "$preset: downloaded $got bytes, expected $bytes" >&2; exit 1; }
    echo "result: $preset $dims $bytes bytes"
  done

echo "attempts recorded:"
docker compose exec -T postgres psql -U pdp -d metadata -tAc \
  "select attempt, outcome from job_executions where job_id = '$job_id' order by attempt"
echo "OK"
