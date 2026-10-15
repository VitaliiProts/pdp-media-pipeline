#!/usr/bin/env bash
# Stage 2 load tests against a running `docker compose up` stack.
# k6 runs in Docker inside the compose network; autocannon runs from the host.
#
#   scripts/perf.sh                       # all k6 scenarios
#   scripts/perf.sh rate-limit spike      # some of them
#   scripts/perf.sh autocannon            # GET /v1/jobs/:id with autocannon
#   scripts/perf.sh slo-burn              # Stage 4 demo: dashboards and a burn-rate alert
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

scenarios=("$@")
[[ ${#scenarios[@]} -gt 0 ]] || scenarios=(api-baseline rate-limit spike backpressure)

seed_users
for scenario in "${scenarios[@]}"; do
  case "$scenario" in
    backpressure) backpressure ;;
    autocannon) autocannon ;;
    *) k6 "$scenario" ;;
  esac
done
