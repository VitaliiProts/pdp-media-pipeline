#!/usr/bin/env node
// Tables for perf/reports/stage-5d.md from one `scripts/perf.sh dub-load` run:
//   node scripts/dub-load-report.mjs perf/reports/raw
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'perf/reports/raw';
const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

const before = read('dub-load-metrics-before.json');
const after = read('dub-load-metrics-after.json');
const jobs = read('dub-load-jobs.json');
const k6 = read('dub-load.json');

const key = (labels) => JSON.stringify(Object.entries(labels).sort());
const series = (snapshot, name) => snapshot.find((m) => m.name === name)?.result ?? [];
/**
 * Increase of a counter summed by `by`. Subtracted per series: one that appeared during the run
 * started from zero, one of a container gone by the end is not counted.
 */
function delta(name, by) {
  const was = new Map(series(before, name).map((r) => [key(r.labels), r.value]));
  const sums = new Map();
  for (const r of series(after, name)) {
    const labels = Object.fromEntries(by.map((l) => [l, r.labels[l]]));
    const increase = r.value - (was.get(key(r.labels)) ?? 0);
    const k = key(labels);
    sums.set(k, { labels, value: (sums.get(k)?.value ?? 0) + increase });
  }
  return [...sums.values()].filter((r) => r.value > 1e-9);
}

const round = (n, digits = 2) => Number(n.toFixed(digits));
const table = (head, rows) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');

const cost = delta('dub_cost_usd_total', ['provider']);
const totalCost = cost.reduce((sum, r) => sum + r.value, 0);
const succeeded = jobs.byStatus?.succeeded ?? 0;

const out = [];
out.push('## Jobs');
out.push(
  table(
    ['', 'Value'],
    [
      ['by status', JSON.stringify(jobs.byStatus ?? {})],
      ['executions by outcome', JSON.stringify(jobs.executions ?? {})],
      ['jobs that succeeded twice', jobs.succeededTwice],
      ['dead reasons', JSON.stringify(jobs.deadReasons ?? {})],
      ['last errors', JSON.stringify(jobs.lastErrors ?? [])],
    ],
  ),
);

out.push('\n## Cost');
out.push(
  table(
    ['Provider', 'USD'],
    [
      ...cost.map((r) => [r.labels.provider, round(r.value, 4)]),
      ['total', round(totalCost, 4)],
      ['per succeeded dub', succeeded ? round(totalCost / succeeded, 4) : '—'],
    ],
  ),
);

const CALL = ['provider', 'operation', 'outcome'];
const calls = delta('dub_provider_duration_seconds_count', CALL);
const callSeconds = delta('dub_provider_duration_seconds_sum', CALL);
out.push('\n## Provider calls');
out.push(
  table(
    ['Provider', 'Operation', 'Outcome', 'Calls', 'Mean, s'],
    calls
      .sort((a, b) => key(a.labels).localeCompare(key(b.labels)))
      .map((r) => {
        const seconds = callSeconds.find((s) => key(s.labels) === key(r.labels))?.value ?? 0;
        const { provider, operation, outcome } = r.labels;
        return [provider, operation, outcome, round(r.value, 0), round(seconds / r.value, 1)];
      }),
  ),
);

const steps = delta('dub_step_duration_seconds_count', ['step', 'outcome']);
const stepSeconds = delta('dub_step_duration_seconds_sum', ['step', 'outcome']);
out.push('\n## Steps');
out.push(
  table(
    ['Step', 'Outcome', 'Count', 'Mean, s'],
    steps.map((r) => {
      const seconds = stepSeconds.find((s) => key(s.labels) === key(r.labels))?.value ?? 0;
      return [r.labels.step, r.labels.outcome, round(r.value, 0), round(seconds / r.value, 1)];
    }),
  ),
);

const metric = (name) => k6.metrics[name] ?? {};
const trend = (name) => {
  const m = metric(name);
  return m['p(95)'] === undefined
    ? '—'
    : `med ${round(m.med)} / p95 ${round(m['p(95)'])} / max ${round(m.max)}`;
};
out.push('\n## k6');
out.push(
  table(
    ['Metric', 'Value'],
    [
      ['POST /v1/jobs (video.dub), ms', trend('http_req_duration{name:POST /v1/jobs (video.dub)}')],
      [
        'GET /v1/jobs/:id (video.dub), ms',
        trend('http_req_duration{name:GET /v1/jobs/:id (video.dub)}'),
      ],
      ['GET /v1/dub-quota, ms', trend('http_req_duration{name:GET /v1/dub-quota}')],
      ['end to end, s', trend('dub_e2e_seconds')],
      ['within 15 min', round(metric('dub_within_slo').value ?? 0, 3)],
      ['succeeded', round(metric('dub_succeeded').value ?? 0, 3)],
      ['attempts', trend('dub_attempts')],
      ['phrase start offset, max per dub, s', trend('dub_start_offset_seconds')],
      ['iterations', metric('iterations').count ?? 0],
      ['poll timeouts', metric('dub_poll_timeout').count ?? 0],
    ],
  ),
);

const failed = Object.entries(k6.metrics).flatMap(([name, m]) =>
  Object.entries(m.thresholds ?? {})
    .filter(([, ok]) => ok === true)
    .map(([t]) => `${name}: ${t}`),
);
out.push(`\nThresholds failed: ${failed.length ? failed.join('; ') : 'none'}`);

console.log(out.join('\n'));
