#!/usr/bin/env node
// Checkpoint 2 log check over the chaos runs (docs/plan/stage-6.md), from VictoriaLogs: errors
// and warnings by service in every run, every line of a request or a job carries `trace_id`,
// and every error says what it is about.
//
//   kubectl -n pdp port-forward svc/victorialogs 9428 &
//   VL_URL=http://127.0.0.1:9428 node scripts/chaos-logs.mjs [--raw perf/reports/raw/stage-6]
//
// Takes the latest run of each scenario that has a `timeline` (scripts/chaos.sh), writes
// logs.json into --raw, prints Markdown tables, exits 1 if a check fails.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const SERVICES = ['api-gateway', 'metadata', 'scheduler', 'worker', 'video-worker'];

/** Before stage 6, failed responses were logged at `info`: they count as errors either way. */
const ERROR = '(severity_text:error or res.statusCode:>=500)';

/**
 * What an error is about: a job (`job_id`), a request that has no job yet, e.g. creating one
 * (`req.id`), or a component loop such as the outbox relay or a NATS consumer (`context`).
 */
const ERROR_CONTEXT = {
  job: '-job_id:""',
  request: 'job_id:"" -req.id:""',
  component: 'job_id:"" req.id:"" -context:""',
  none: 'job_id:"" req.id:"" context:""',
};

/** `start`, `fault-on`, `fault-off` and `end` of a run as ISO times. */
export function parseTimeline(text) {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length === 2),
  );
}

/** The latest `<scenario>-YYYYMMDD-HHMMSS` of each scenario, in scenario order. */
export function latestRuns(names) {
  const latest = new Map();
  for (const name of [...names].sort()) {
    const match = name.match(/^(.+)-\d{8}-\d{6}$/);
    if (match) latest.set(match[1], name);
  }
  return [...latest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, run]) => run);
}

export function failures({ runs, session }) {
  const out = [];
  for (const run of runs) {
    if (run.errors.none > 0) out.push(`${run.run}: ${run.errors.none} errors without context`);
  }
  if (session.scopedUntraced > 0) {
    out.push(`${session.scopedUntraced} lines of a request or a job without trace_id`);
  }
  return out;
}

export function markdown({ runs, session }) {
  const cell = (counts) => (counts ? `${counts.errors} / ${counts.warnings}` : '0 / 0');
  const lines = [
    `| Прогін | ${SERVICES.join(' | ')} | Задача | Запит | Компонент | Без контексту |`,
    `| --- | ${SERVICES.map(() => '---').join(' | ')} | --- | --- | --- | --- |`,
    ...runs.map(
      (r) =>
        `| ${r.scenario} | ${SERVICES.map((s) => cell(r.services[s])).join(' | ')} | ` +
        `${r.errors.job} | ${r.errors.request} | ${r.errors.component} | ${r.errors.none} |`,
    ),
    '',
    `| Сервіс | Рядків | З trace_id | Запиту чи задачі без trace_id |`,
    `| --- | --- | --- | --- |`,
    ...SERVICES.map((s) => {
      const t = session.services[s] ?? { lines: 0, traced: 0, scopedUntraced: 0 };
      const share = t.lines ? `${((100 * t.traced) / t.lines).toFixed(1)}%` : '—';
      return `| ${s} | ${t.lines} | ${share} | ${t.scopedUntraced} |`;
    }),
  ];
  return lines.join('\n');
}

async function logsql(vl, query) {
  const res = await fetch(`${vl}/select/logsql/query`, {
    method: 'POST',
    body: new URLSearchParams({ query }),
  });
  if (!res.ok) throw new Error(`VictoriaLogs: ${res.status} ${await res.text()}`);
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const window = (from, to) => `_time:[${from}, ${to}]`;

async function runCounts(vl, timeline) {
  const w = window(timeline.start, timeline.end);
  const byService = await logsql(
    vl,
    `${w} (${ERROR} or severity_text:warn) | stats by (service) ` +
      `count() if (${ERROR}) errors, count() if (severity_text:warn) warnings`,
  );
  const [errors = {}] = await logsql(
    vl,
    `${w} ${ERROR} | stats ` +
      Object.entries(ERROR_CONTEXT)
        .map(([name, filter]) => `count() if (${filter}) ${name}`)
        .join(', '),
  );
  return {
    services: Object.fromEntries(
      byService.map((r) => [r.service, { errors: Number(r.errors), warnings: Number(r.warnings) }]),
    ),
    errors: Object.fromEntries(Object.keys(ERROR_CONTEXT).map((k) => [k, Number(errors[k] ?? 0)])),
  };
}

async function sessionCounts(vl, from, to) {
  const rows = await logsql(
    vl,
    `${window(from, to)} * | stats by (service) count() lines, ` +
      `count() if (-trace_id:"") traced, ` +
      `count() if (trace_id:"" (-job_id:"" or -req.id:"")) scopedUntraced`,
  );
  const services = Object.fromEntries(
    rows.map((r) => [
      r.service,
      {
        lines: Number(r.lines),
        traced: Number(r.traced),
        scopedUntraced: Number(r.scopedUntraced),
      },
    ]),
  );
  const scopedUntraced = Object.values(services).reduce((n, s) => n + s.scopedUntraced, 0);
  return { from, to, services, scopedUntraced };
}

async function main() {
  const { values } = parseArgs({
    options: { raw: { type: 'string', default: 'perf/reports/raw/stage-6' } },
  });
  const vl = process.env.VL_URL ?? 'http://127.0.0.1:9428';
  const names = readdirSync(values.raw).filter((n) => existsSync(join(values.raw, n, 'timeline')));
  const runs = [];
  for (const run of latestRuns(names)) {
    const timeline = parseTimeline(readFileSync(join(values.raw, run, 'timeline'), 'utf8'));
    const scenario = run.replace(/-\d{8}-\d{6}$/, '');
    runs.push({ run, scenario, timeline, ...(await runCounts(vl, timeline)) });
  }
  if (runs.length === 0) throw new Error(`no runs with a timeline in ${values.raw}`);
  const starts = runs.map((r) => r.timeline.start).sort();
  const ends = runs.map((r) => r.timeline.end).sort();
  const session = await sessionCounts(vl, starts[0], ends.at(-1));
  const result = { runs, session, failures: failures({ runs, session }) };
  writeFileSync(join(values.raw, 'logs.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(markdown(result));
  for (const failure of result.failures) console.error(`  ${failure}`);
  process.exitCode = result.failures.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
