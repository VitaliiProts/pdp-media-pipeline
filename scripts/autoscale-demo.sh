#!/usr/bin/env bash
# Stage 5.3 demo against the k3d cluster from `pnpm k8s:up` (ADR-012). Under the
# perf/k6/video-load.js load:
#
#   1. KEDA scales video-transcode and video-frames out on consumer lag;
#   2. `kubectl rollout restart` with the chart's grace: running jobs finish first;
#   3. the same with a 2 s grace: running transcodes are handed back as interrupted;
#   4. the queue drains and both scale back in to one pod.
#
# Then it checks Postgres and VictoriaMetrics: every job created finished, none dead,
# no job succeeded twice, interrupted attempts did not count.
#
#   scripts/autoscale-demo.sh                 # about 13 minutes
#   HOLD=3m scripts/autoscale-demo.sh         # shorter load
#
# Samples (replicas, lag) go to perf/reports/raw/autoscale-*; charts and numbers are
# turned into perf/reports/stage-5.md by scripts/autoscale-report.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."

NS=pdp
K6_IMAGE="${K6_IMAGE:-grafana/k6:1.3.0}"
VM=http://vm.pdp.localhost:19080
RAW=perf/reports/raw
FIXTURE=perf/k6/fixtures/video.mp4
RAMP="${RAMP:-1m}"
HOLD="${HOLD:-5m}"
# Seconds after the load starts: by then the deployments have scaled out.
RESTART_AT="${RESTART_AT:-150}"
SHORT_GRACE_AT="${SHORT_GRACE_AT:-220}"
INTERRUPT_AT="${INTERRUPT_AT:-290}"
SHORT_GRACE_MS=2000
DEPLOYMENTS=(video-transcode video-frames)
CONSUMERS=(video-transcode-priority video-transcode-cpu video-priority video-cpu)
mkdir -p "$RAW"

need() { command -v "$1" >/dev/null || { echo "missing dependency: $1" >&2; exit 1; }; }
need kubectl
need docker
need jq
need curl

log() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$*"; }
event() {
  log "$*"
  printf '%s,%s\n' "$(($(date +%s) - T0))" "$*" >>"$RAW/autoscale-events.csv"
}
psql_in() { kubectl -n "$NS" exec -i postgres-1 -c postgres -- psql -d metadata "$@"; }
sql() { psql_in -tAc "$1"; }

# 60 s of 1080p test pattern, about 20 s of transcoding at 2 CPUs.
fixture() {
  [[ -f "$FIXTURE" ]] && return
  log "generating $FIXTURE"
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/perf/k6/fixtures:/out" \
    --entrypoint ffmpeg pdp/video-worker:dev -v error -f lavfi \
    -i testsrc2=size=1920x1080:rate=30 -t 60 -c:v libx264 -preset veryfast -crf 28 \
    -pix_fmt yuv420p -y /out/video.mp4
}

seed_users() {
  kubectl -n "$NS" exec -i deploy/metadata -- node -e "
    const { seedUser } = require('./dist/seed-user.js');
    (async () => {
      for (let n = 1; n <= 3; n++) {
        const id = String(n).padStart(2, '0');
        try {
          await seedUser(process.env.DATABASE_URL, 'perf-' + id, 'pdp_perf_' + id + '_local');
        } catch (err) {
          if (err.cause?.code !== '23505' && err.code !== '23505') throw err;
        }
      }
    })().catch((err) => { console.error(err); process.exit(1); });
  "
}

lag() {
  kubectl get --raw "/api/v1/namespaces/$NS/services/nats:8222/proxy/jsz?consumers=true" |
    jq -r --arg names "${CONSUMERS[*]}" '
      [.account_details[].stream_detail[].consumer_detail[]?
        | select(.name as $n | $names | split(" ") | index($n))
        | {(.name): (.num_pending + .num_ack_pending)}] | add as $lag
      | $names | split(" ") | map($lag[.] // 0) | join(",")'
}

replicas() {
  local d
  for d in "${DEPLOYMENTS[@]}"; do
    kubectl -n "$NS" get deploy "$d" -o jsonpath='{.status.replicas},{.status.readyReplicas},'
  done
}

# Every 5 s: replicas (existing, ready) per deployment and lag per consumer.
sample() {
  local header="t" d c
  for d in "${DEPLOYMENTS[@]}"; do header+=",$d,$d-ready"; done
  for c in "${CONSUMERS[@]}"; do header+=",lag-$c"; done
  echo "$header" >"$RAW/autoscale-samples.csv"
  while :; do
    printf '%s,%s%s\n' "$(($(date +%s) - T0))" "$(replicas)" "$(lag)" >>"$RAW/autoscale-samples.csv"
    sleep 5
  done
}

at() {
  local wait=$(($1 - ($(date +%s) - T0)))
  ((wait > 0)) && sleep "$wait"
  return 0
}

rollout() {
  local d
  for d in "${DEPLOYMENTS[@]}"; do kubectl -n "$NS" rollout status "deploy/$d" --timeout 10m >/dev/null; done
  event "rollout done"
}

unfinished() {
  sql "select count(*) from jobs where created_at >= '$START' and status not in ('succeeded', 'failed', 'dead')"
}

# Increase of a counter over the run, from VictoriaMetrics.
increase() {
  curl -sS --fail "$VM/api/v1/query" --data-urlencode "query=sum(increase($1[$(($(date +%s) - T0 + 60))s]))" |
    jq -r '.data.result[0].value[1] // "0" | tonumber | round'
}

fixture
seed_users
CHART_GRACE_MS="$(kubectl -n "$NS" get deploy video-transcode -o json | jq -r \
  '.spec.template.spec.containers[0].env[] | select(.name == "WORKER_SHUTDOWN_GRACE_MS").value')"
: >"$RAW/autoscale-events.csv"
START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
T0=$(date +%s)
echo "$T0" >"$RAW/autoscale-t0"
sample &
SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null || true' EXIT

event "load starts (ramp $RAMP, hold $HOLD)"
docker run --rm --user "$(id -u):$(id -g)" \
  --add-host api.pdp.localhost:host-gateway --add-host s3.pdp.localhost:host-gateway \
  -v "$PWD/perf/k6:/scripts:ro" -v "$PWD/$RAW:/out" \
  -e BASE_URL=http://api.pdp.localhost:19080 -e STORAGE_URL=http://s3.pdp.localhost:19080 \
  -e RAMP="$RAMP" -e HOLD="$HOLD" \
  "$K6_IMAGE" run --quiet --summary-export /out/video-load.json /scripts/video-load.js \
  >"$RAW/video-load.txt" 2>&1 &
K6=$!
sleep 15
kill -0 "$K6" 2>/dev/null || { cat "$RAW/video-load.txt" >&2; exit 1; }

at "$RESTART_AT"
event "rollout restart (grace $CHART_GRACE_MS ms)"
kubectl -n "$NS" rollout restart "${DEPLOYMENTS[@]/#/deploy/}" >/dev/null
rollout

at "$SHORT_GRACE_AT"
event "video-transcode: WORKER_SHUTDOWN_GRACE_MS=$SHORT_GRACE_MS"
kubectl -n "$NS" set env deploy/video-transcode WORKER_SHUTDOWN_GRACE_MS=$SHORT_GRACE_MS >/dev/null
rollout

at "$INTERRUPT_AT"
event "rollout restart (grace ${SHORT_GRACE_MS} ms: running transcodes are interrupted)"
kubectl -n "$NS" rollout restart deploy/video-transcode >/dev/null
rollout

wait "$K6" || event "k6 exited with $?"
event "load ends"

until [[ "$(unfinished)" == 0 ]]; do sleep 5; done
event "all jobs finished"

# Back to the chart's grace while idle, so nothing is interrupted by this rollout.
kubectl -n "$NS" set env deploy/video-transcode "WORKER_SHUTDOWN_GRACE_MS=$CHART_GRACE_MS" >/dev/null
rollout

until [[ "$(replicas)" == "1,1,1,1," ]]; do sleep 10; done
event "scaled back in"
sleep 10
kill "$SAMPLER"

log "checks"
sql "copy (select type, status, count(*) as jobs from jobs where created_at >= '$START'
      group by 1, 2 order by 1, 2) to stdout with csv header" | tee "$RAW/autoscale-jobs.csv"
sql "copy (select j.type, coalesce(e.outcome::text, 'open') as outcome, count(*) as executions
      from job_executions e join jobs j on j.id = e.job_id where j.created_at >= '$START'
      group by 1, 2 order by 1, 2) to stdout with csv header" | tee "$RAW/autoscale-executions.csv"
cat >"$RAW/autoscale-checks.txt" <<EOF
created            $(sql "select count(*) from jobs where created_at >= '$START'")
succeeded          $(sql "select count(*) from jobs where created_at >= '$START' and status = 'succeeded'")
dead               $(sql "select count(*) from jobs where created_at >= '$START' and status = 'dead'")
succeeded twice    $(sql "select count(*) from (select e.job_id from job_executions e join jobs j on j.id = e.job_id
                      where j.created_at >= '$START' and e.outcome = 'succeeded' group by 1 having count(*) > 1) d")
interrupted jobs   $(sql "select count(distinct e.job_id) from job_executions e join jobs j on j.id = e.job_id
                      where j.created_at >= '$START' and e.outcome = 'interrupted'")
max counted tries  $(sql "select coalesce(max(n), 0) from (select count(*) n from job_executions e join jobs j on j.id = e.job_id
                      where j.created_at >= '$START' and e.outcome is distinct from 'interrupted' group by e.job_id) c")
metrics created    $(increase 'jobs_created_total{type=~"video.*"}')
metrics finished   $(increase 'jobs_finished_total{type=~"video.*"}')
metrics interrupted $(increase 'jobs_interrupted_total')
metrics dlq        $(increase 'jobs_dlq_total')
duplicates caught  $(increase 'jobs_duplicates_total')
EOF
cat "$RAW/autoscale-checks.txt"

# e2e latency per job, exact: the job.e2e.duration histogram only has bucket resolution.
sql "copy (select type, round(extract(epoch from created_at) - $T0, 1) as created_s,
      round(extract(epoch from finished_at - created_at), 1) as e2e_s
      from jobs where created_at >= '$START' order by created_at) to stdout with csv header" \
  >"$RAW/autoscale-e2e.csv"
log "done: $RAW/autoscale-*"
