import exec from 'k6/execution';
import http from 'k6/http';
import { check, fail } from 'k6';
import { apiKey, BASE_URL, createJob, headers, uploadSource } from './lib/common.js';

/**
 * Stage 4 demo: fills the dashboards and burns the image.resize error budget.
 *
 * Two image jobs a second succeed; one more a second has a source URL that answers 500,
 * so it is retried until exhausted. A third of the jobs are bad, 33x the 1% budget:
 * JobSloBurnRateFast fires once both its 1h and 5m windows are over 14.4, about
 * 5 minutes in: a bad job counts only after its retries are exhausted. After the run
 * the 5m window empties and the alert resolves.
 *
 * A webhook endpoint per user adds webhook.deliver jobs to the picture.
 */
const USERS = 3;
const DURATION = __ENV.DURATION || '8m';
const FAILING_SOURCE = 'http://webhook-receiver:3000/fail';

export const options = {
  scenarios: {
    good: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 5,
      exec: 'good',
    },
    bad: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 5,
      exec: 'bad',
    },
  },
  thresholds: {
    'checks{check:accepted}': ['rate>0.99'],
  },
};

export function setup() {
  const users = [];
  for (let n = 1; n <= USERS; n++) {
    const key = apiKey(n);
    const webhook = http.post(
      `${BASE_URL}/v1/webhooks`,
      JSON.stringify({
        url: 'http://webhook-receiver:3000/ok',
        events: ['job.succeeded', 'job.dead'],
      }),
      { headers: headers(key), tags: { name: 'setup' } },
    );
    if (webhook.status !== 201) fail(`POST /v1/webhooks: ${webhook.status} ${webhook.body}`);
    users.push({ key, sourceKey: uploadSource(key), webhookId: webhook.json('id') });
  }
  return { users };
}

const user = (data) => data.users[exec.scenario.iterationInTest % data.users.length];

const accepted = (res) => check(res, { accepted: (r) => r.status === 202 });

export function good(data) {
  const { key, sourceKey } = user(data);
  accepted(createJob(key, sourceKey));
}

export function bad(data) {
  const { key } = user(data);
  accepted(
    http.post(
      `${BASE_URL}/v1/jobs`,
      JSON.stringify({ type: 'image.resize', sourceUrl: FAILING_SOURCE, presets: ['thumb'] }),
      { headers: headers(key), tags: { name: 'POST /v1/jobs (failing source)' } },
    ),
  );
}

export function teardown(data) {
  for (const { key, webhookId } of data.users) {
    http.del(`${BASE_URL}/v1/webhooks/${webhookId}`, null, {
      headers: headers(key),
      tags: { name: 'teardown' },
    });
  }
}
