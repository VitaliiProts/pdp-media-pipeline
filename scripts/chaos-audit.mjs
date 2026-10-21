#!/usr/bin/env node
// Audit of one chaos run (scripts/chaos.sh, docs/plan/stage-6.md): lost jobs, duplicates with
// a visible effect, DLQ share. Every job of the run belongs to the run's own user.
//
//   node scripts/chaos-audit.mjs --dir perf/reports/raw/stage-6/<run> --scenario <name> \
//     --user <uuid> --since <iso time the load started>
//
// Writes audit.json into --dir, prints a Markdown table row, exits 1 if the run failed.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const MAX_DUPLICATES_PERMILLE = 0.1;
const MAX_DLQ_PERCENT = 1;
const K6_COUNTERS = ['accepted', 'gave_up', 'retries', 'key_mismatch', 'rejected_4xx'];

const round = (n, digits) => Number(n.toFixed(digits));
const sum = (values) => values.reduce((a, b) => a + b, 0);

/** Counters from `k6 --summary-export`; a counter never incremented is absent. */
export function k6Counts(summary) {
  return Object.fromEntries(
    K6_COUNTERS.map((name) => [name, summary.metrics[`chaos_${name}`]?.count ?? 0]),
  );
}

export function summarize({ db, k6, openai, caught }) {
  const paidOver = (step) => Math.max(0, openai[step].paid - db.dubs);
  const duplicateKinds = {
    keyless: db.keyless,
    succeeded_twice: db.succeeded_twice,
    webhook: db.dup_webhook,
    paid_transcribe: paidOver('transcribe'),
    paid_translate: paidOver('translate'),
    key_mismatch: k6.key_mismatch,
  };
  const duplicates = sum(Object.values(duplicateKinds));
  const lost = db.unfinished + db.deliveries_unfinished + Math.max(0, k6.accepted - db.keys);
  const jobs = Math.max(db.jobs, 1);
  const result = {
    jobs: db.jobs,
    lost,
    lost_webhooks: db.lost_webhook,
    duplicates,
    duplicate_kinds: duplicateKinds,
    duplicates_permille: round((1000 * duplicates) / jobs, 2),
    dead: db.dead,
    dead_reasons: db.dead_reasons,
    dlq_percent: round((100 * db.dead) / jobs, 2),
    deliveries_dead: db.deliveries_dead,
    p95_e2e_s: db.p95_e2e_s,
    caught,
    caught_total: sum(Object.values(caught)),
    k6,
    openai,
  };

  const failures = [];
  if (db.jobs === 0) failures.push('no jobs in the run');
  if (lost > 0) failures.push(`${lost} lost jobs`);
  if (db.lost_webhook > 0) failures.push(`${db.lost_webhook} lost webhooks`);
  if (result.duplicates_permille >= MAX_DUPLICATES_PERMILLE) {
    failures.push(`duplicates ${result.duplicates_permille}‰ >= ${MAX_DUPLICATES_PERMILLE}‰`);
  }
  if (result.dlq_percent >= MAX_DLQ_PERCENT) {
    failures.push(`DLQ ${result.dlq_percent}% >= ${MAX_DLQ_PERCENT}%`);
  }
  if (db.dubs_succeeded > openai.transcribe.paid) {
    failures.push('dubs succeeded without paid calls: video-dub is not on openai-mock');
  }
  if (k6.rejected_4xx > 0) failures.push(`${k6.rejected_4xx} requests rejected with 4xx`);
  return { ...result, failures, pass: failures.length === 0 };
}

export function markdownRow(scenario, r) {
  const cells = [
    scenario,
    r.jobs,
    r.lost,
    r.duplicates_permille.toFixed(2),
    r.dlq_percent.toFixed(2),
    r.p95_e2e_s,
    r.caught_total,
    r.k6.retries,
    r.pass ? 'pass' : 'FAIL',
  ];
  return `| ${cells.join(' | ')} |`;
}

const auditQuery = (userId) => `
with j as (
  select id, type, status, dead_reason, created_at, finished_at from jobs
  where user_id = '${userId}' and type::text <> 'webhook.deliver'
), d as (
  select status, input->'payload'->'data'->>'jobId' as job_id, input->'payload'->>'type' as event
  from jobs where user_id = '${userId}' and type::text = 'webhook.deliver'
), w as (
  select job_id, event, count(*) as n from d group by 1, 2
)
select json_build_object(
  'jobs', (select count(*) from j),
  'unfinished', (select count(*) from j where status::text not in ('succeeded', 'failed', 'dead')),
  'dead', (select count(*) from j where status::text = 'dead'),
  'keys', (select count(*) from idempotency_keys where user_id = '${userId}'),
  'keyless', (select count(*) from j where not exists
    (select 1 from idempotency_keys k where k.job_id = j.id)),
  'succeeded_twice', (select count(*) from (select e.job_id from job_executions e
    join j on j.id = e.job_id where e.outcome = 'succeeded' group by 1 having count(*) > 1) t),
  'dup_webhook', (select coalesce(sum(n - 1), 0) from w),
  'lost_webhook', (select count(*) from j where status::text in ('succeeded', 'dead')
    and not exists (select 1 from w where w.job_id = j.id::text and w.event = 'job.' || j.status::text)),
  'deliveries_unfinished', (select count(*) from d where status::text not in ('succeeded', 'failed', 'dead')),
  'deliveries_dead', (select count(*) from d where status::text = 'dead'),
  'dubs', (select count(*) from j where type::text = 'video.dub'),
  'dubs_succeeded', (select count(*) from j where type::text = 'video.dub' and status::text = 'succeeded'),
  'p95_e2e_s', (select coalesce(round(percentile_cont(0.95) within group
    (order by extract(epoch from finished_at - created_at))::numeric, 1), 0) from j
    where finished_at is not null),
  'dead_reasons', (select coalesce(json_object_agg(reason, n), '{}') from
    (select coalesce(dead_reason::text, 'none') as reason, count(*) as n from j
     where status::text = 'dead' group by 1) r)
)`;

function collect({ user, since, dir }) {
  const ns = process.env.NS || 'pdp';
  const pgPod = process.env.PG_POD || 'postgres-1';
  const vm = process.env.VM_URL || 'http://vm.pdp.localhost:19080';
  const kubectl = (args) => execFileSync('kubectl', ['-n', ns, ...args], { encoding: 'utf8' });

  if (!/^[0-9a-f-]{36}$/.test(user)) throw new Error(`--user is not a uuid: ${user}`);
  const db = JSON.parse(
    kubectl([
      'exec',
      '-i',
      pgPod,
      '-c',
      'postgres',
      '--',
      'psql',
      '-d',
      'metadata',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      auditQuery(user),
    ]),
  );
  const openai = JSON.parse(
    kubectl(['exec', 'deploy/openai-mock', '--', 'wget', '-qO-', 'http://127.0.0.1:8080/calls']),
  );
  const k6 = k6Counts(JSON.parse(readFileSync(join(dir, 'k6.json'), 'utf8')));
  return { db, k6, openai, vm, since };
}

async function caughtDuplicates(vm, since) {
  const window = Math.ceil((Date.now() - Date.parse(since)) / 1000) + 60;
  const query = `sum by (source) (increase(jobs_duplicates_total[${window}s]))`;
  const res = await fetch(`${vm}/api/v1/query?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`VictoriaMetrics: ${res.status} ${await res.text()}`);
  const { data } = await res.json();
  return Object.fromEntries(
    data.result.map((s) => [s.metric.source ?? 'unknown', Math.round(Number(s.value[1]))]),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      scenario: { type: 'string' },
      user: { type: 'string' },
      since: { type: 'string' },
    },
  });
  const { dir, scenario, user, since } = values;
  if (!dir || !scenario || !user || !since) {
    throw new Error(
      'usage: chaos-audit.mjs --dir <dir> --scenario <name> --user <uuid> --since <iso>',
    );
  }
  const { db, k6, openai, vm } = collect({ user, since, dir });
  const caught = await caughtDuplicates(vm, since);
  const result = { scenario, user, since, ...summarize({ db, k6, openai, caught }) };
  writeFileSync(join(dir, 'audit.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(markdownRow(scenario, result));
  for (const failure of result.failures) console.error(`  ${scenario}: ${failure}`);
  process.exitCode = result.pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
