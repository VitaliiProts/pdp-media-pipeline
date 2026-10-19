import exec from 'k6/execution';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { apiKey, BASE_URL, checkRetryAfter, headers, uploadFile } from './lib/common.js';

/**
 * Stage 5d: video.dub end to end under load (scripts/perf.sh dub-load). Each iteration creates
 * one dub, replays it with the same Idempotency-Key and polls it like a client until it ends.
 * A steady phase below the capacity of the stack is followed by a peak above it.
 *
 * With DUB_PROVIDERS=openai every dub is paid (about $0.018 for a minute of speech), and a job
 * already queued is processed even after k6 stops. MAX_DUBS is the only bound on the bill.
 */
const MAX_DUBS = Number(__ENV.MAX_DUBS || 80);
/** Each perf user may dub 30 minutes a month: a rerun takes the next users (DUB_USER_FROM). */
const USERS = Number(__ENV.DUB_USERS || 4);
const USER_FROM = Number(__ENV.DUB_USER_FROM || 1);
const STEADY_PER_HOUR = Number(__ENV.STEADY_PER_HOUR || 45);
const STEADY = __ENV.STEADY || '30m';
const PEAK_PER_HOUR = Number(__ENV.PEAK_PER_HOUR || 120);
const PEAK = __ENV.PEAK || '29m';
const POLL_SECONDS = Number(__ENV.POLL_SECONDS || 3);
const POLL_LIMIT_MINUTES = Number(__ENV.POLL_LIMIT_MINUTES || 60);
const RUN = __ENV.RUN || String(Date.now());
const SLO_SECONDS = 900;
const LANGUAGES = ['uk', 'de', 'es', 'fr'];
const FINAL = ['succeeded', 'dead', 'cancelled'];

const clip = open(__ENV.DUB_CLIP || '/clip/clip.mp4', 'b');

const e2e = new Trend('dub_e2e_seconds');
const withinSlo = new Rate('dub_within_slo');
const succeeded = new Rate('dub_succeeded');
const dead = new Counter('dub_dead');
const timedOut = new Counter('dub_poll_timeout');
const startOffset = new Trend('dub_start_offset_seconds');
const attempts = new Trend('dub_attempts');

const CREATE = 'POST /v1/jobs (video.dub)';
const POLL = 'GET /v1/jobs/:id (video.dub)';
const QUOTA = 'GET /v1/dub-quota';

export const options = {
  setupTimeout: '5m',
  scenarios: {
    dubs: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1h',
      startRate: STEADY_PER_HOUR,
      stages: [
        { target: STEADY_PER_HOUR, duration: STEADY },
        { target: PEAK_PER_HOUR, duration: '1s' },
        { target: PEAK_PER_HOUR, duration: PEAK },
      ],
      preAllocatedVUs: 20,
      maxVUs: 120,
      // An iteration lasts as long as its dub: queued ones finish after the arrivals stop.
      gracefulStop: `${POLL_LIMIT_MINUTES}m`,
      exec: 'dub',
    },
    burst: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      startTime: '2m',
      exec: 'burst',
    },
  },
  thresholds: {
    'checks{check:accepted}': ['rate>0.99'],
    'checks{check:replayed}': ['rate>0.99'],
    [`http_req_duration{name:${CREATE}}`]: ['p(95)<150'],
    [`http_req_duration{name:${POLL}}`]: ['p(95)<150'],
    [`http_req_duration{name:${QUOTA}}`]: ['p(95)<150'],
    dub_succeeded: ['rate>0.99'],
    dub_within_slo: ['rate>0.95'],
  },
};

export function setup() {
  const users = [];
  for (let n = USER_FROM; n < USER_FROM + USERS; n++) {
    const key = apiKey(n);
    users.push({ key, sourceKey: uploadFile(key, clip, 'video/mp4') });
  }
  return { users };
}

function request(data, n) {
  const user = data.users[n % data.users.length];
  return {
    user,
    body: JSON.stringify({
      type: 'video.dub',
      sourceKey: user.sourceKey,
      targetLanguage: LANGUAGES[n % LANGUAGES.length],
    }),
    params: {
      headers: headers(user.key, { 'Idempotency-Key': `dub-load-${RUN}-${n}` }),
      tags: { name: CREATE },
    },
  };
}

const seconds = (from, to) => (Date.parse(to) - Date.parse(from)) / 1000;

export function dub(data) {
  const n = exec.scenario.iterationInTest;
  if (n >= MAX_DUBS) return;
  const { user, body, params } = request(data, n);

  const created = http.post(`${BASE_URL}/v1/jobs`, body, params);
  checkRetryAfter(created);
  if (!check(created, { accepted: (r) => r.status === 202 })) return;
  const jobId = created.json('jobId');

  const replay = http.post(`${BASE_URL}/v1/jobs`, body, params);
  check(replay, {
    replayed: (r) =>
      r.status === 202 && r.headers['Idempotent-Replayed'] === 'true' && r.json('jobId') === jobId,
  });

  const quota = http.get(`${BASE_URL}/v1/dub-quota`, {
    headers: headers(user.key),
    tags: { name: QUOTA },
  });
  check(quota, { 'quota 200': (r) => r.status === 200 });

  const deadline = Date.now() + POLL_LIMIT_MINUTES * 60_000;
  while (Date.now() < deadline) {
    sleep(POLL_SECONDS);
    const res = http.get(`${BASE_URL}/v1/jobs/${jobId}`, {
      headers: headers(user.key),
      tags: { name: POLL },
    });
    checkRetryAfter(res);
    if (res.status !== 200) continue;
    const job = res.json();
    if (!FINAL.includes(job.status)) continue;

    const took = seconds(job.createdAt, job.finishedAt);
    e2e.add(took);
    withinSlo.add(took <= SLO_SECONDS);
    succeeded.add(job.status === 'succeeded');
    attempts.add(job.attempts);
    if (job.status === 'dead') dead.add(1);
    if (job.status === 'succeeded') {
      const offsets = job.dub.phrases.map((p) => Math.abs(p.placedStart - p.start));
      startOffset.add(Math.max(0, ...offsets));
      check(job, {
        'dub has video and subtitles': (j) => Boolean(j.dub.video?.url && j.dub.subtitles?.url),
      });
    }
    return;
  }
  timedOut.add(1);
}

/** One user over the per-user limit, replaying the first dub: no request may create a job. */
export function burst(data) {
  const { body, params } = request(data, 0);
  const responses = http.batch(
    Array.from({ length: 30 }, () => ['POST', `${BASE_URL}/v1/jobs`, body, params]),
  );
  const ids = new Set(responses.filter((r) => r.status === 202).map((r) => r.json('jobId')));
  responses.forEach(checkRetryAfter);
  check(responses, {
    'burst gets 429': (rs) => rs.some((r) => r.status === 429),
    'burst creates no second job': () => ids.size <= 1,
  });
}
