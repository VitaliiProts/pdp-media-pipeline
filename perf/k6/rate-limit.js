import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { apiKey, BASE_URL, checkRetryAfter, headers } from './lib/common.js';

/**
 * Two runs against GET /v1/jobs, each checked against what GCRA should let through
 * with the default limits (user 20 rps / burst 20, global 200 rps / burst 200):
 *
 * - single_user: one user at 40 rps for 30 s. Allowed ≈ 20 × 30 + 20 = 620 of 1200,
 *   so ≈ 48% are refused.
 * - global: 15 other users at 20 rps each (300 rps) for 30 s. Each user stays within
 *   its own limit; the global one allows ≈ 200 × 30 + 200 = 6200 of 9000, so ≈ 31%
 *   are refused.
 */
const DURATION_S = 30;
const GLOBAL_USERS = 15;

const rateLimited = new Rate('rate_limited');

export const options = {
  scenarios: {
    single_user: {
      executor: 'constant-arrival-rate',
      rate: 40,
      timeUnit: '1s',
      duration: `${DURATION_S}s`,
      preAllocatedVUs: 20,
      maxVUs: 100,
      env: { FIRST_USER: '1', USERS: '1' },
    },
    global: {
      executor: 'constant-arrival-rate',
      rate: GLOBAL_USERS * 20,
      timeUnit: '1s',
      duration: `${DURATION_S}s`,
      startTime: `${DURATION_S + 5}s`,
      preAllocatedVUs: 100,
      maxVUs: 400,
      env: { FIRST_USER: '2', USERS: String(GLOBAL_USERS) },
    },
  },
  thresholds: {
    'rate_limited{scenario:single_user}': ['rate>0.43', 'rate<0.53'],
    'rate_limited{scenario:global}': ['rate>0.26', 'rate<0.36'],
    'http_req_duration{scenario:single_user}': ['p(95)<150'],
    'http_req_duration{scenario:global}': ['p(95)<150'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const first = Number(__ENV.FIRST_USER);
  const user = first + (exec.scenario.iterationInTest % Number(__ENV.USERS));
  const res = http.get(`${BASE_URL}/v1/jobs?limit=1`, {
    headers: headers(apiKey(user)),
    tags: { name: 'GET /v1/jobs' },
  });

  rateLimited.add(res.status === 429);
  check(res, {
    'allowed or rate limited': (r) => r.status === 200 || r.status === 429,
    'has RateLimit headers': (r) =>
      r.headers['Ratelimit-Limit'] !== undefined && r.headers['Ratelimit-Remaining'] !== undefined,
  });
  checkRetryAfter(res);
}
