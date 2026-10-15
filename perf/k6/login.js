import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from './lib/common.js';

/**
 * Sign-in under load. argon2id is slow on purpose (19 MiB, 2 passes, ADR-013): this measures
 * what one login costs — its P95 here, the Metadata CPU in Grafana or in the samples
 * scripts/perf.sh takes. perf.sh seeds the users with passwords and lifts the sign-in limits
 * (10/min per IP, 1/min per email) for the run; k6 signs in from one IP.
 *
 * The cookie is `Secure` and k6 talks plain HTTP inside compose, so it never sends it back:
 * every login is a fresh session, and the ones a run leaves in Redis expire with their TTL.
 */
const USERS = Number(__ENV.LOGIN_USERS || 20);
const RATE = Number(__ENV.RATE || 20);
const PASSWORD = __ENV.LOGIN_PASSWORD || 'perf-login-password';

export const loginEmail = (n) => `login-${String(n).padStart(2, '0')}@perf.test`;

export const options = {
  scenarios: {
    login: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  thresholds: {
    'http_req_duration{name:POST /v1/auth/login}': ['p(95)<500'],
    'http_req_failed{scenario:login}': ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const user = (exec.scenario.iterationInTest % USERS) + 1;
  const res = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email: loginEmail(user), password: PASSWORD }),
    { headers: { 'content-type': 'application/json' }, tags: { name: 'POST /v1/auth/login' } },
  );
  check(res, {
    'signed in': (r) => r.status === 200,
    'session cookie set': (r) => (r.headers['Set-Cookie'] || '').includes('pdp_session='),
  });
}
