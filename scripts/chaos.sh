#!/usr/bin/env bash
# Stage 6.1 chaos runs (docs/plan/stage-6.md) against the k3d cluster from `pnpm k8s:up` with
# Chaos Mesh from `scripts/k8s.sh chaos-mesh`. Per scenario, about 10 minutes:
#
#   1. a fresh user with a webhook to webhook-receiver, so every job of the run is its own;
#   2. video-dub on openai-mock, so its paid calls are counted;
#   3. perf/k6/chaos.js for $DURATION; the failure from deploy/chaos/<scenario> starts at
#      $FAULT_AT seconds and lasts as long as the manifest says;
#   4. the failure is removed, the queues drain, scripts/chaos-audit.mjs checks the run.
#
#   scripts/chaos.sh baseline              # no failure: the load and the audit themselves
#   scripts/chaos.sh 01-worker-kill        # one scenario
#   scripts/chaos.sh all                   # every scenario, then a summary table
#   scripts/chaos.sh --target aws all      # the final AWS session of stage 8
#
# Raw data goes to perf/reports/raw/stage-6/<run>/.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET=k3d
if [[ "${1:-}" == --target ]]; then
  TARGET="${2:?--target k3d|aws}"
  shift 2
fi
SCENARIO="${1:?usage: scripts/chaos.sh [--target k3d|aws] <baseline|all|scenario>}"
[[ "$TARGET" == k3d ]] || { echo "--target $TARGET: not yet, see the final AWS session" >&2; exit 1; }

NS=pdp
K6_IMAGE="${K6_IMAGE:-grafana/k6:1.3.0}"
API=http://api.pdp.localhost:19080
VM=http://vm.pdp.localhost:19080
RAW=perf/reports/raw/stage-6
FIXTURE=perf/k6/fixtures/chaos.mp4
DURATION="${DURATION:-5m}"
RATE="${RATE:-5}"
FAULT_AT="${FAULT_AT:-60}"
DRAIN_TIMEOUT_S="${DRAIN_TIMEOUT_S:-900}"
RECEIVER_URL=http://webhook-receiver:3000/ok
# Not in k3d: audio-separate is off there (values-dev.yaml).
SKIP_K3D=(09-audio-separate)
mkdir -p "$RAW"

need() { command -v "$1" >/dev/null || { echo "missing dependency: $1" >&2; exit 1; }; }
need kubectl
need docker
need jq
need curl
need node

log() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$*"; }
psql_in() { kubectl -n "$NS" exec -i postgres-1 -c postgres -- psql -d metadata "$@"; }
sql() { psql_in -tAc "$1"; }

# Pending and unacked messages over every consumer, outbox events included.
lag() {
  kubectl get --raw "/api/v1/namespaces/$NS/services/nats:8222/proxy/jsz?consumers=true" |
    jq '[.account_details[].stream_detail[].consumer_detail[]?
      | .num_pending + .num_ack_pending] | add // 0'
}

# 10 s of 640x360 with a tone: video.frames and video.dub both have something to work on.
fixture() {
  [[ -f "$FIXTURE" ]] && return
  log "generating $FIXTURE"
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/perf/k6/fixtures:/out" \
    --entrypoint ffmpeg pdp/video-worker:dev -v error \
    -f lavfi -i testsrc2=size=640x360:rate=25 -f lavfi -i sine=frequency=440:sample_rate=48000 \
    -t 10 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -shortest -y /out/chaos.mp4
}

# mock <method> <path> [json body]; busybox wget in the pod knows only GET and POST.
mock() {
  kubectl -n "$NS" exec -i deploy/openai-mock -- node -e '
    const [method, path, body] = process.argv.slice(1);
    fetch("http://127.0.0.1:8080" + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body || undefined,
    }).then(async (res) => {
      process.stdout.write(await res.text());
      if (!res.ok) process.exit(1);
    });
  ' "$@"
}

openai_mock() {
  kubectl -n "$NS" create configmap openai-mock --from-file=perf/openai-mock/server.mjs \
    --dry-run=client -o yaml | kubectl -n "$NS" apply -f - >/dev/null
  kubectl -n "$NS" apply -f deploy/chaos/openai-mock.yaml >/dev/null
  # A changed server.mjs reaches the pod only through a restart.
  local sum
  sum=$(shasum perf/openai-mock/server.mjs | cut -c1-12)
  kubectl -n "$NS" patch deploy openai-mock --type merge -p \
    "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"pdp/server-sha\":\"$sum\"}}}}}" >/dev/null
  kubectl -n "$NS" rollout status deploy/openai-mock --timeout 2m >/dev/null
}

dub_on_mock() {
  kubectl -n "$NS" set env deploy/video-dub DUB_PROVIDERS=openai OPENAI_API_KEY=sk-chaos \
    OPENAI_BASE_URL=http://openai-mock:8080/v1 DUB_TTS=fake DUB_AUDIO_SEPARATE=fake >/dev/null
  kubectl -n "$NS" rollout status deploy/video-dub --timeout 5m >/dev/null
}

# Back to values-dev.yaml: fakes inside the process. Run by the EXIT trap.
# shellcheck disable=SC2329
dub_restore() {
  kubectl -n "$NS" set env deploy/video-dub DUB_PROVIDERS=fake OPENAI_API_KEY- OPENAI_BASE_URL- \
    DUB_TTS- >/dev/null || true
}

# Prints "<userId> <apiKey> <email> <password>".
new_user() {
  local name="$1" stamp key email password
  stamp=$(date +%s)
  key="pdp_chaos_${stamp}_local"
  email="${name}@chaos.pdp.localhost"
  password="chaos-${stamp}-password"
  kubectl -n "$NS" exec -i deploy/metadata -- node -e "
    const { seedUser } = require('./dist/seed-user.js');
    seedUser(process.env.DATABASE_URL, '$name', { apiKey: '$key', email: '$email', password: '$password' })
      .then((u) => console.log(u.userId))
      .catch((err) => { console.error(err); process.exit(1); });
  " | tr -d '\r' | awk -v k="$key" -v e="$email" -v p="$password" '{ print $1, k, e, p }'
}

webhook() {
  curl -sS --fail -X POST "$API/v1/webhooks" -H "x-api-key: $1" -H 'content-type: application/json' \
    -d "{\"url\":\"$RECEIVER_URL\",\"events\":[\"job.succeeded\",\"job.dead\"]}" >/dev/null
}

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" || true; }

# Browsers keep a Secure cookie from http://*.localhost, curl drops it: the Cookie header is
# built from Set-Cookie by hand and written to $1.
login() {
  code -X POST "$API/v1/auth/login" -H 'content-type: application/json' -D "$1.headers" -d "$2"
  tr -d '\r' <"$1.headers" | sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p' | paste -sd ';' - >"$1"
}

# Every 2 s while the load runs: what a client sees. Login is limited to a burst of 5 per
# email and 1 a minute after that, so it is tried every 40 s; the session in between.
probe() {
  local dir="$1" key="$2" body jar="$1/cookies" t0 t
  body=$(jq -nc --arg email "$3" --arg password "$4" '{ $email, $password }')
  login "$jar" "$body" >/dev/null
  t0=$(date +%s)
  echo "t,ready,me_by_key,me_by_session,login" >"$dir/probes.csv"
  while :; do
    t=$(($(date +%s) - t0))
    printf '%s,%s,%s,%s,%s\n' "$t" \
      "$(code "$API/health/ready")" \
      "$(code "$API/v1/me" -H "x-api-key: $key")" \
      "$(code "$API/v1/me" -H "cookie: $(cat "$jar")")" \
      "$( ((t % 40 < 2)) && login "$dir/cookies-probe" "$body")" \
      >>"$dir/probes.csv"
    sleep 2
  done
}

fault_file() {
  local f
  for f in deploy/chaos/"$1".yaml deploy/chaos/"$1".json; do
    [[ -f "$f" ]] && { echo "$f"; return; }
  done
  echo "no scenario $1 in deploy/chaos" >&2
  exit 1
}

fault_on() {
  case "$1" in
    *.json) mock PUT /faults "$(cat "$1")" >/dev/null ;;
    *) kubectl -n "$NS" apply -f "$1" >/dev/null ;;
  esac
}

fault_off() {
  case "$1" in
    *.json) mock DELETE /faults >/dev/null ;;
    *) kubectl -n "$NS" delete -f "$1" --ignore-not-found >/dev/null ;;
  esac
}

unfinished() {
  sql "select count(*) from jobs where user_id = '$1' and status::text not in ('succeeded', 'failed', 'dead')"
}

drain() {
  local user="$1" waited=0
  until [[ "$(unfinished "$user")" == 0 && "$(lag)" == 0 ]]; do
    ((waited >= DRAIN_TIMEOUT_S)) && { log "not drained after ${DRAIN_TIMEOUT_S}s"; return 0; }
    sleep 5
    waited=$((waited + 5))
  done
  log "drained in ${waited}s"
}

run() {
  local scenario="$1" file="" run dir user key email password since k6 prober
  [[ "$scenario" == baseline ]] || file=$(fault_file "$scenario")
  run="${scenario}-$(date +%Y%m%d-%H%M%S)"
  dir="$RAW/$run"
  mkdir -p "$dir"
  log "$run"

  read -r user key email password < <(new_user "chaos-$scenario-$(date +%s)")
  webhook "$key"
  mock DELETE /calls >/dev/null
  mock DELETE /faults >/dev/null
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  docker run --rm --user "$(id -u):$(id -g)" \
    --add-host api.pdp.localhost:host-gateway --add-host s3.pdp.localhost:host-gateway \
    -v "$PWD/perf/k6:/scripts:ro" -v "$PWD/$dir:/out" \
    -e BASE_URL="$API" -e STORAGE_URL=http://s3.pdp.localhost:19080 \
    -e API_KEY="$key" -e RUN="$run" -e RATE="$RATE" -e DURATION="$DURATION" \
    "$K6_IMAGE" run --quiet --summary-export /out/k6.json /scripts/chaos.js \
    >"$dir/k6.txt" 2>&1 &
  k6=$!
  probe "$dir" "$key" "$email" "$password" &
  prober=$!

  if [[ -n "$file" ]]; then
    sleep "$FAULT_AT"
    log "fault on: $file"
    fault_on "$file"
  fi
  wait "$k6" || log "k6 exited with $? (see $dir/k6.txt)"
  kill "$prober" 2>/dev/null || true
  wait "$prober" 2>/dev/null || true
  rm -f "$dir"/cookies*
  if [[ -n "$file" ]]; then
    fault_off "$file"
    log "fault off"
  fi

  drain "$user"
  VM_URL="$VM" node scripts/chaos-audit.mjs --dir "$dir" --scenario "$scenario" --user "$user" \
    --since "$since" | tee -a "$RAW/summary.md"
}

scenarios() {
  local f name
  for f in deploy/chaos/[0-9][0-9]-*; do
    name=$(basename "${f%.*}")
    [[ " ${SKIP_K3D[*]} " == *" $name "* ]] && continue
    echo "$name"
  done | sort -u
}

# A child run of `all` finds everything prepared.
if [[ -z "${CHAOS_PREPARED:-}" ]]; then
  fixture
  openai_mock
  dub_on_mock
  trap 'dub_restore' EXIT
fi

if [[ "$SCENARIO" != all ]]; then
  run "$SCENARIO"
  exit
fi

printf '\n| scenario | jobs | lost | dup ‰ | DLQ %% | p95 s | caught | retries | result |\n' >>"$RAW/summary.md"
printf '| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' >>"$RAW/summary.md"
status=0
# Each in its own process: `set -e` does not apply inside a function called with `||`.
for s in $(scenarios); do CHAOS_PREPARED=1 "$0" "$s" || status=1; done
exit "$status"
