import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { apiKey, BASE_URL, checkRetryAfter, headers, USER_COUNT } from './lib/common.js';

/**
 * A sudden 6× jump from normal traffic to three times the global limit and back.
 * The excess must be refused quickly with 429 rather than slow everyone down:
 * no 5xx, and the requests that were let through keep their latency.
 */
const rateLimited = new Rate('rate_limited');
const serverErrors = new Rate('server_errors');

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 600,
      stages: [
        { target: 100, duration: '20s' },
        { target: 600, duration: '5s' },
        { target: 600, duration: '20s' },
        { target: 100, duration: '5s' },
        { target: 100, duration: '20s' },
      ],
    },
  },
  thresholds: {
    server_errors: ['rate<0.001'],
    'http_req_duration{expected_response:true}': ['p(95)<150'],
    'http_req_duration{status:429}': ['p(95)<50'],
    rate_limited: ['rate>0.2'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const user = 1 + (exec.scenario.iterationInTest % USER_COUNT);
  const res = http.get(`${BASE_URL}/v1/jobs?limit=1`, {
    headers: headers(apiKey(user)),
    tags: { name: 'GET /v1/jobs' },
  });

  rateLimited.add(res.status === 429);
  serverErrors.add(res.status >= 500 || res.status === 0);
  check(res, { 'allowed or rate limited': (r) => r.status === 200 || r.status === 429 });
  checkRetryAfter(res);
}
