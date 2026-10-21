#!/usr/bin/env node
// Backend coverage of the unit and integration runs together, and the floors CI holds it to:
// the whole backend, and each area users depend on most, its Web UI files included.
//
//   node scripts/coverage.mjs     # after pnpm test:cov, pnpm test:int --coverage, pnpm test:web:cov
//
// Writes coverage-merged/ (summary, lcov) and exits 1 below a floor.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

export const BACKEND_RUNS = ['coverage/coverage-final.json', 'coverage-int/coverage-final.json'];
export const WEB_RUN = 'apps/web/coverage/coverage-final.json';

/** Branches stay at the level the merged runs reached, so they only go up. */
export const BACKEND_FLOOR = { lines: 80, branches: 78 };
export const AREA_FLOOR = { lines: 80 };

/** Files by path from the repository root; an area is covered by every run that touches it. */
export const AREAS = {
  login: [
    /^apps\/api-gateway\/src\/auth\/auth\.(controller|guard|dto)\.ts$/,
    /^apps\/metadata\/src\/auth\//,
    /^apps\/web\/src\/features\/auth\//,
    /^apps\/web\/src\/pages\/(login|register)\//,
  ],
  sessions: [
    /^apps\/api-gateway\/src\/auth\/(session\.service|session-cookie|user)\.ts$/,
    /^apps\/web\/src\/app\/layouts\/RequireAuth\.tsx$/,
  ],
  library: [
    /^apps\/api-gateway\/src\/assets\//,
    /^apps\/metadata\/src\/assets\//,
    /^apps\/web\/src\/features\/assets\//,
    /^apps\/web\/src\/pages\/(library|asset)\//,
  ],
  'dub fitting': [/^apps\/video-worker\/src\/dub\/fit\//],
};

const pct = (covered, total) => (total === 0 ? 100 : Math.round((covered / total) * 10_000) / 100);

/** Lines and branches of the files of `map` whose relative path matches one of `patterns`. */
export function summarise(map, root, patterns = [/./]) {
  const summary = libCoverage.createCoverageSummary();
  let files = 0;
  for (const file of map.files()) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (!patterns.some((p) => p.test(relative))) continue;
    summary.merge(map.fileCoverageFor(file).toSummary());
    files++;
  }
  return {
    files,
    lines: pct(summary.lines.covered, summary.lines.total),
    branches: pct(summary.branches.covered, summary.branches.total),
  };
}

/** Every floor `summary` falls below, as readable lines. */
export function shortfalls(name, summary, floor) {
  if (summary.files === 0) return [`${name}: no files matched`];
  return Object.entries(floor)
    .filter(([metric, min]) => summary[metric] < min)
    .map(([metric, min]) => `${name}: ${metric} ${summary[metric]}% < ${min}%`);
}

const load = (file) => {
  if (!existsSync(file)) throw new Error(`${file} is missing: run its tests with coverage first`);
  return JSON.parse(readFileSync(file, 'utf8'));
};

function main() {
  const root = process.cwd();
  const backend = libCoverage.createCoverageMap({});
  for (const run of BACKEND_RUNS) backend.merge(load(run));
  const all = libCoverage.createCoverageMap({});
  all.merge(backend);
  all.merge(load(WEB_RUN));

  const context = libReport.createContext({ dir: 'coverage-merged', coverageMap: backend });
  for (const name of ['text-summary', 'json-summary', 'lcov'])
    reports.create(name).execute(context);

  const rows = [['backend', summarise(backend, root), BACKEND_FLOOR]];
  for (const [name, patterns] of Object.entries(AREAS))
    rows.push([name, summarise(all, root, patterns), AREA_FLOOR]);

  const table = [
    '## Coverage: unit and integration together',
    '',
    '| Scope | Files | Lines | Branches |',
    '| --- | --- | --- | --- |',
    ...rows.map(([name, s]) => `| ${name} | ${s.files} | ${s.lines}% | ${s.branches}% |`),
  ].join('\n');
  console.log(`\n${table}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);

  const failed = rows.flatMap(([name, summary, floor]) => shortfalls(name, summary, floor));
  for (const line of failed) console.error(`coverage below the floor: ${line}`);
  if (failed.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
