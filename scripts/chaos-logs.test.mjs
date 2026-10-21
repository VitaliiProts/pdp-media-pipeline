import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { failures, latestRuns, markdown, parseTimeline } from './chaos-logs.mjs';

const run = (none) => ({
  run: '04-postgres-partition-20261021-155743',
  scenario: '04-postgres-partition',
  services: { 'api-gateway': { errors: 966, warnings: 966 } },
  errors: { job: 0, request: 966, component: 0, none },
});
const session = (scopedUntraced) => ({
  services: { metadata: { lines: 200, traced: 150, scopedUntraced } },
  scopedUntraced,
});

describe('parseTimeline', () => {
  it('reads the marks of a run', () => {
    assert.deepEqual(
      parseTimeline('start 2026-10-21T12:57:44Z\nfault-on 2026-10-21T12:58:44Z\n\n'),
      { start: '2026-10-21T12:57:44Z', 'fault-on': '2026-10-21T12:58:44Z' },
    );
  });
});

describe('latestRuns', () => {
  it('keeps the last run of each scenario', () => {
    assert.deepEqual(
      latestRuns([
        '10-minio-partition-20261021-172147',
        '03-nats-kill-20261021-170419',
        '10-minio-partition-20261021-161818',
        '03-nats-kill-20261021-155223',
        'summary.md',
      ]),
      ['03-nats-kill-20261021-170419', '10-minio-partition-20261021-172147'],
    );
  });
});

describe('failures', () => {
  it('passes when every error has a context and every scoped line a trace', () => {
    assert.deepEqual(failures({ runs: [run(0)], session: session(0) }), []);
  });

  it('names errors without context and untraced lines', () => {
    assert.deepEqual(failures({ runs: [run(2)], session: session(3) }), [
      '04-postgres-partition-20261021-155743: 2 errors without context',
      '3 lines of a request or a job without trace_id',
    ]);
  });
});

describe('markdown', () => {
  it('prints errors / warnings per service and the trace share', () => {
    const table = markdown({ runs: [run(0)], session: session(0) });
    assert.match(table, /\| 04-postgres-partition \| 966 \/ 966 \| 0 \/ 0 \|/);
    assert.match(table, /\| metadata \| 200 \| 75\.0% \| 0 \|/);
    assert.match(table, /\| worker \| 0 \| — \| 0 \|/);
  });
});
