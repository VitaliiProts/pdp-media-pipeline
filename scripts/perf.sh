#!/usr/bin/env bash
# Stage 2 load tests against a running `docker compose up` stack.
# k6 runs in Docker inside the compose network; autocannon runs from the host.
#
#   scripts/perf.sh                       # all k6 scenarios
#   scripts/perf.sh rate-limit spike      # some of them
#   scripts/perf.sh autocannon            # GET /v1/jobs/:id with autocannon
#   scripts/perf.sh slo-burn              # Stage 4 demo: dashboards and a burn-rate alert
#   scripts/perf.sh login                 # Stage 5c: sign-in P95 and Metadata CPU (argon2id)
#   LOGIN_RATE=60 scripts/perf.sh login   # the same at 60 logins/s
#   scripts/perf.sh dub-load              # Stage 5d: video.dub under load, `--profile dub` stack;
#                                         # paid with DUB_PROVIDERS=openai, MAX_DUBS bounds the bill
#
# Raw output lands in perf/reports/raw/ (git-ignored); numbers go to perf/reports/stage-N.md.
set -euo pipefail
cd "$(dirname "$0")/.."

K6_IMAGE="${K6_IMAGE:-grafana/k6:1.3.0}"
NETWORK="${COMPOSE_PROJECT_NAME:-pdp}_default"
GATEWAY="${GATEWAY:-http://localhost:${GATEWAY_HOST_PORT:-18080}}"
USERS="${USERS:-30}"
BACKPRESSURE_DEPTH="${BACKPRESSURE_DEPTH:-50}"
RAW="perf/reports/raw"
mkdir -p "$RAW"

need() { command -v "$1" >/dev/null || { echo "missing dependency: $1" >&2; exit 1; }; }
need docker
need curl
need jq

api_key() { printf 'pdp_perf_%02d_local' "$1"; }

seed_users() {
  echo "seeding $USERS perf users"
  docker compose exec -T metadata node -e "
    const { seedUser } = require('./dist/seed-user.js');
    (async () => {
      for (let n = 1; n <= $USERS; n++) {
        const id = String(n).padStart(2, '0');
        try {
          await seedUser(process.env.DATABASE_URL, 'perf-' + id, { apiKey: 'pdp_perf_' + id + '_local' });
        } catch (err) {
          if (err.cause?.code !== '23505' && err.code !== '23505') throw err;
        }
      }
    })().catch((err) => { console.error(err); process.exit(1); });
  "
}

reset_limits() {
  docker compose exec -T redis sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del" >/dev/null
}

# Recreates the gateway with extra env; with no arguments, back to the compose defaults.
restart_gateway() {
  env "$@" docker compose up -d --no-deps --wait api-gateway >/dev/null
}

k6() {
  local name="$1"
  shift
  reset_limits
  echo "== k6 $name"
  docker run --rm --network "$NETWORK" --user "$(id -u):$(id -g)" \
    -v "$PWD/perf/k6:/scripts:ro" -v "$PWD/$RAW:/out" \
    -e BASE_URL=http://api-gateway:3000 -e USERS="$USERS" "$@" \
    "$K6_IMAGE" run --quiet --summary-export "/out/$name.json" "/scripts/$name.js" |
    tee "$RAW/$name.txt"
}

backpressure() {
  trap 'restart_gateway; docker compose start worker >/dev/null' RETURN
  docker compose stop worker >/dev/null
  restart_gateway BACKPRESSURE_MAX_DEPTH_CPU="$BACKPRESSURE_DEPTH"
  k6 backpressure
}

autocannon() {
  local key job_id
  key="$(api_key 1)"
  job_id="$(curl -sS --fail -H "x-api-key: $key" "$GATEWAY/v1/jobs?limit=1" | jq -r '.items[0].id')"
  [[ "$job_id" != null ]] || { echo "no job for perf user 1; run api-baseline first" >&2; exit 1; }

  echo "== autocannon GET /v1/jobs/:id, limits lifted"
  trap restart_gateway RETURN
  restart_gateway RATE_LIMIT_USER_RPS=1000000 RATE_LIMIT_USER_BURST=1000000 \
    RATE_LIMIT_GLOBAL_RPS=1000000 RATE_LIMIT_GLOBAL_BURST=1000000
  reset_limits
  pnpm dlx autocannon@8 -c 50 -d 30 -H "x-api-key=$key" "$GATEWAY/v1/jobs/$job_id" 2>&1 |
    tee "$RAW/autocannon-unlimited.txt"

  echo "== autocannon GET /v1/jobs/:id, default limits (one user, 20 rps)"
  restart_gateway
  reset_limits
  pnpm dlx autocannon@8 -c 50 -d 30 -H "x-api-key=$key" "$GATEWAY/v1/jobs/$job_id" 2>&1 |
    tee "$RAW/autocannon-limited.txt"
}

LOGIN_USERS="${LOGIN_USERS:-20}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-perf-login-password}"

# login-01@perf.test, ... with a password: what perf/k6/login.js signs in as.
seed_login_users() {
  echo "seeding $LOGIN_USERS sign-in users"
  docker compose exec -T -e LOGIN_PASSWORD="$LOGIN_PASSWORD" metadata node -e "
    const { seedUser } = require('./dist/seed-user.js');
    (async () => {
      for (let n = 1; n <= $LOGIN_USERS; n++) {
        const id = String(n).padStart(2, '0');
        try {
          await seedUser(process.env.DATABASE_URL, 'login-' + id, {
            email: 'login-' + id + '@perf.test',
            password: process.env.LOGIN_PASSWORD,
          });
        } catch (err) {
          if (err.cause?.code !== '23505' && err.code !== '23505') throw err;
        }
      }
    })().catch((err) => { console.error(err); process.exit(1); });
  "
}

# argon2id runs in Metadata: its CPU next to the gateway's, every 2 s while k6 runs.
sample_cpu() {
  local containers
  containers="$(docker compose ps -q metadata api-gateway)"
  while :; do
    # shellcheck disable=SC2086
    docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' $containers
    sleep 2
  done
}

login() {
  seed_login_users
  restart_gateway AUTH_IP_RATE_PER_MIN=1000000 AUTH_IP_BURST=1000000 \
    AUTH_EMAIL_RATE_PER_MIN=1000000 AUTH_EMAIL_BURST=1000000
  sample_cpu >"$RAW/login-cpu.txt" 2>&1 &
  local sampler=$! status=0
  # Not a RETURN trap: a failed threshold makes `set -e` leave the script without returning,
  # and the sampler would outlive it.
  k6 login -e LOGIN_USERS="$LOGIN_USERS" -e LOGIN_PASSWORD="$LOGIN_PASSWORD" \
    -e RATE="${LOGIN_RATE:-20}" -e DURATION="${LOGIN_DURATION:-60s}" || status=$?
  kill "$sampler" 2>/dev/null || true
  restart_gateway
  return "$status"
}

DUB_CLIP="${DUB_CLIP:-spikes/02-video-dub/input/tos-1min.mp4}"
DUB_WORKERS="${DUB_WORKERS:-2}"
MAX_DUBS="${MAX_DUBS:-80}"
VM="http://localhost:${VICTORIAMETRICS_HOST_PORT:-18428}"

# Raw counters per series, not increase(): VictoriaMetrics extrapolates a series that appears
# mid-window. Every container has its own series (`host_name`), so the report subtracts per
# series and a replaced container's leftovers drop out.
dub_metrics() {
  local name
  for name in dub_cost_usd_total dub_provider_duration_seconds_count \
    dub_provider_duration_seconds_sum dub_step_duration_seconds_count \
    dub_step_duration_seconds_sum; do
    curl -sS --fail "$VM/api/v1/query" --data-urlencode "query=$name" |
      jq -c --arg name "$name" \
        '{name: $name, result: [.data.result[] | {labels: .metric, value: (.value[1] | tonumber)}]}'
  done | jq -s .
}

# Dubs created since $1: statuses, executions, and jobs that succeeded twice (a paid duplicate).
dub_jobs() {
  docker compose exec -T postgres psql -U pdp -d metadata -At -v since="$1" <<'SQL'
with run as (
  select j.* from jobs j join users u on u.id = j.user_id
  where j.type = 'video.dub' and u.name like 'perf-%' and j.created_at >= :'since'
)
select json_build_object(
  'byStatus', (select json_object_agg(status, n) from
    (select status, count(*) n from run group by status) s),
  'executions', (select json_object_agg(coalesce(outcome::text, 'running'), n) from
    (select e.outcome, count(*) n from job_executions e join run on run.id = e.job_id
     group by e.outcome) o),
  'succeededTwice', (select count(*) from
    (select e.job_id from job_executions e join run on run.id = e.job_id
     where e.outcome = 'succeeded' group by e.job_id having count(*) > 1) d),
  'deadReasons', (select json_object_agg(coalesce(dead_reason::text, '?'), n) from
    (select dead_reason, count(*) n from run where status = 'dead' group by dead_reason) r),
  'lastErrors', (select json_agg(distinct last_error) from run where last_error is not null)
);
SQL
}

dub_load() {
  [[ -f "$DUB_CLIP" ]] || { echo "no clip at $DUB_CLIP (DUB_CLIP=...)" >&2; exit 1; }
  local providers since override status=0
  providers="$(docker compose exec -T video-dub printenv DUB_PROVIDERS)"
  echo "== dub-load: up to $MAX_DUBS dubs of $DUB_CLIP, providers: $providers, $DUB_WORKERS video-dub"
  [[ "$providers" != openai ]] || echo "   paid: about \$0.018 per minute of speech, at most $MAX_DUBS dubs"

  # Replicas cannot share the host port of video-dub.
  override="$(mktemp)"
  printf 'services:\n  video-dub:\n    ports: !reset []\n' >"$override"
  docker compose -f docker-compose.yml -f "$override" --profile dub --profile dub-separate \
    up -d --no-deps --wait --scale video-dub="$DUB_WORKERS" video-dub >/dev/null

  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  dub_metrics >"$RAW/dub-load-metrics-before.json"
  local clip_dir
  clip_dir="$(cd "$(dirname "$DUB_CLIP")" && pwd)"
  k6 dub-load -v "$clip_dir/$(basename "$DUB_CLIP"):/clip/clip.mp4:ro" \
    -e MAX_DUBS="$MAX_DUBS" -e RUN="$(date +%s)" \
    -e DUB_USERS="${DUB_USERS:-4}" -e DUB_USER_FROM="${DUB_USER_FROM:-1}" \
    -e STEADY="${STEADY:-30m}" -e PEAK="${PEAK:-29m}" \
    -e STEADY_PER_HOUR="${STEADY_PER_HOUR:-45}" -e PEAK_PER_HOUR="${PEAK_PER_HOUR:-120}" ||
    status=$?
  # Services push metrics every 15 s (OTEL_METRIC_EXPORT_INTERVAL), the collector batches them.
  sleep 45
  dub_metrics >"$RAW/dub-load-metrics-after.json"
  dub_jobs "$since" >"$RAW/dub-load-jobs.json"

  docker compose --profile dub --profile dub-separate \
    up -d --no-deps --wait --scale video-dub=1 video-dub >/dev/null
  rm -f "$override"
  node scripts/dub-load-report.mjs "$RAW" | tee "$RAW/dub-load-report.md"
  return "$status"
}

scenarios=("$@")
[[ ${#scenarios[@]} -gt 0 ]] || scenarios=(api-baseline rate-limit spike backpressure)

seed_users
for scenario in "${scenarios[@]}"; do
  case "$scenario" in
    backpressure) backpressure ;;
    autocannon) autocannon ;;
    login) login ;;
    dub-load) dub_load ;;
    *) k6 "$scenario" ;;
  esac
done
