import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, createJob, headers, seedUsers } from './lib/common.js';

/**
 * Normal traffic well inside the limits: 10 users at 10 rps each (100 rps total),
 * half of it polling a job, a third listing, the rest creating jobs.
 * Done when P95 of every endpoint stays under 150 ms and nothing is refused.
 */
const USERS = 10;
const RATE = Number(__ENV.RATE || 100);

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    'http_req_duration{scenario:baseline}': ['p(95)<150'],
    'http_req_duration{name:GET /v1/jobs/:id}': ['p(95)<150'],
    'http_req_duration{name:GET /v1/jobs}': ['p(95)<150'],
    'http_req_duration{name:POST /v1/jobs}': ['p(95)<150'],
    'http_req_failed{scenario:baseline}': ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return seedUsers(USERS);
}

export default function (users) {
  const iteration = exec.scenario.iterationInTest;
  const user = users[iteration % USERS];
  const pick = Math.floor(iteration / USERS) % 10;

  let res;
  if (pick < 5) {
    res = http.get(`${BASE_URL}/v1/jobs/${user.jobId}`, {
      headers: headers(user.key),
      tags: { name: 'GET /v1/jobs/:id' },
    });
  } else if (pick < 8) {
    res = http.get(`${BASE_URL}/v1/jobs?limit=20`, {
      headers: headers(user.key),
      tags: { name: 'GET /v1/jobs' },
    });
  } else {
    res = createJob(user.key, user.sourceKey);
  }
  check(res, { 'not refused': (r) => r.status === 200 || r.status === 202 });
}
