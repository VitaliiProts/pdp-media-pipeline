import exec from 'k6/execution';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { checkRetryAfter, createJob, seedUsers } from './lib/common.js';

/**
 * Run with the worker stopped and a low BACKPRESSURE_MAX_DEPTH_CPU (scripts/perf.sh
 * does both). Jobs pile up in the cpu stream until the threshold, after which the
 * gateway must answer 503 with Retry-After, and answer it fast instead of letting
 * latency grow with the queue. Priority jobs go to their own stream and still pass.
 */
const USERS = 10;
const shed = new Rate('shed');

export const options = {
  scenarios: {
    flood: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
    priority: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      startTime: '10s',
      preAllocatedVUs: 2,
      exec: 'priorityJob',
    },
  },
  thresholds: {
    'shed{scenario:flood}': ['rate>0.7'],
    'http_req_duration{scenario:flood}': ['p(95)<150'],
    'http_req_duration{status:503}': ['p(95)<50'],
    'checks{scenario:priority}': ['rate>0.99'],
    'checks{scenario:flood}': ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return seedUsers(USERS);
}

export default function (users) {
  const user = users[exec.scenario.iterationInTest % USERS];
  const res = createJob(user.key, user.sourceKey);
  shed.add(res.status === 503);
  check(res, { 'accepted or shed': (r) => r.status === 202 || r.status === 503 });
  checkRetryAfter(res);
}

export function priorityJob(users) {
  const user = users[exec.scenario.iterationInTest % USERS];
  const res = createJob(user.key, user.sourceKey, { priority: 9 });
  check(res, { 'priority job accepted': (r) => r.status === 202 });
}
