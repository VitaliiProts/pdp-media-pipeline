import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { k6Counts, markdownRow, summarize } from './chaos-audit.mjs';

const step = (paid) => ({ paid, abandoned: 0, failed: 0 });

const clean = () => ({
  db: {
    jobs: 1500,
    unfinished: 0,
    dead: 3,
    keys: 1500,
    keyless: 0,
    succeeded_twice: 0,
    dup_webhook: 0,
    lost_webhook: 0,
    deliveries_unfinished: 0,
    deliveries_dead: 0,
    dubs: 30,
    dubs_succeeded: 30,
    p95_e2e_s: 12.5,
    dead_reasons: { exhausted: 3 },
  },
  k6: { accepted: 1500, gave_up: 0, retries: 40, key_mismatch: 0, rejected_4xx: 0 },
  openai: { transcribe: step(30), translate: step(30), refit: step(4) },
  caught: { inbox: 7, outbox: 2 },
});

describe('summarize', () => {
  it('passes a clean run', () => {
    const result = summarize(clean());
    assert.equal(result.lost, 0);
    assert.equal(result.duplicates, 0);
    assert.equal(result.dlq_percent, 0.2);
    assert.equal(result.caught_total, 9);
    assert.deepEqual(result.failures, []);
    assert.equal(result.pass, true);
  });

  it('counts a second delivery of one event as a duplicate', () => {
    const input = clean();
    input.db.dup_webhook = 1;
    const result = summarize(input);
    assert.equal(result.duplicates, 1);
    assert.equal(result.duplicates_permille, 0.67);
    assert.equal(result.pass, false);
    assert.match(result.failures.join(), /duplicates/);
  });

  it('counts an accepted job without a row and an unfinished job as lost', () => {
    const input = clean();
    input.db.keys = 1499;
    input.db.unfinished = 1;
    input.db.lost_webhook = 1;
    const result = summarize(input);
    assert.equal(result.lost, 2);
    assert.equal(result.lost_webhooks, 1);
    assert.equal(result.pass, false);
  });

  it('counts a paid step above the number of dubs as a duplicate', () => {
    const input = clean();
    input.openai.translate = step(32);
    assert.equal(summarize(input).duplicates, 2);
  });

  it('fails a run whose dubs did not go to the mock', () => {
    const input = clean();
    input.openai.transcribe = step(0);
    assert.match(summarize(input).failures.join(), /openai-mock/);
  });

  it('fails when the DLQ share reaches 1%', () => {
    const input = clean();
    input.db.dead = 15;
    assert.match(summarize(input).failures.join(), /DLQ/);
  });

  it('fails a run with rejected requests, a bug of the load rather than of the system', () => {
    const input = clean();
    input.k6.rejected_4xx = 1;
    assert.match(summarize(input).failures.join(), /4xx/);
  });
});

describe('k6Counts', () => {
  it('reads the counters and treats a missing one as zero', () => {
    const summary = { metrics: { chaos_accepted: { count: 12 }, chaos_retries: { count: 3 } } };
    assert.deepEqual(k6Counts(summary), {
      accepted: 12,
      gave_up: 0,
      retries: 3,
      key_mismatch: 0,
      rejected_4xx: 0,
    });
  });
});

describe('markdownRow', () => {
  it('renders one table row', () => {
    const row = markdownRow('01-worker-kill', summarize(clean()));
    assert.equal(row, '| 01-worker-kill | 1500 | 0 | 0.00 | 0.20 | 12.5 | 9 | 40 | pass |');
  });
});
