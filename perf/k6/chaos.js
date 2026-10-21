import exec from 'k6/execution';
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, headers, uploadFile } from './lib/common.js';

/**
 * Stage 6.1 load under a failure (scripts/chaos.sh): steady arrivals of mostly image.resize
 * with some video.frames and video.dub, all from the run's own user. Each request carries an
 * Idempotency-Key and is retried with the same key on a network error, 409, 429 and 5xx, as a
 * real client would; scripts/chaos-audit.mjs then checks that no accepted job was lost or
 * done twice.
 */
const API_KEY = __ENV.API_KEY;
const RUN = __ENV.RUN;
const RATE = Number(__ENV.RATE || 5);
const DURATION = __ENV.DURATION || '5m';
/** Out of every 50 jobs: one dub, FRAMES_PER_50 frames, the rest resizes. */
const FRAMES_PER_50 = Number(__ENV.FRAMES_PER_50 || 4);
const BACKOFF_SECONDS = [1, 2, 4, 8, 8];
const RETRYABLE = (status) => status === 0 || status === 409 || status === 429 || status >= 500;

const image = open('./fixtures/source.png', 'b');
const video = open('./fixtures/chaos.mp4', 'b');

const accepted = new Counter('chaos_accepted');
const gaveUp = new Counter('chaos_gave_up');
const retries = new Counter('chaos_retries');
const keyMismatch = new Counter('chaos_key_mismatch');
const rejected4xx = new Counter('chaos_rejected_4xx');

export const options = {
  scenarios: {
    chaos: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 300,
    },
  },
  thresholds: {
    chaos_rejected_4xx: ['count==0'],
    chaos_key_mismatch: ['count==0'],
  },
};

export function setup() {
  if (!API_KEY || !RUN) throw new Error('API_KEY and RUN are required');
  return {
    image: uploadFile(API_KEY, image, 'image/png'),
    video: uploadFile(API_KEY, video, 'video/mp4'),
  };
}

function body(n, data) {
  const slot = n % 50;
  if (slot === 0) return { type: 'video.dub', sourceKey: data.video, targetLanguage: 'uk' };
  if (slot <= FRAMES_PER_50) return { type: 'video.frames', sourceKey: data.video };
  return { type: 'image.resize', sourceKey: data.image, presets: ['thumb'] };
}

const retryAfter = (res, attempt) => {
  const header = Number(res.headers['Retry-After']);
  return header >= 1 ? Math.min(header, 10) : BACKOFF_SECONDS[attempt];
};

export default function (data) {
  const n = exec.scenario.iterationInTest;
  const payload = body(n, data);
  const params = {
    headers: headers(API_KEY, { 'Idempotency-Key': `${RUN}-${n}` }),
    tags: { name: `POST /v1/jobs (${payload.type})` },
    timeout: '10s',
  };
  const post = () => http.post(`${BASE_URL}/v1/jobs`, JSON.stringify(payload), params);
  for (let attempt = 0; ; attempt++) {
    const res = post();
    if (res.status >= 200 && res.status < 300) {
      accepted.add(1);
      // A request that failed on our side may still have created a job: the replay must
      // return that one.
      if (attempt > 0) {
        const replay = post();
        if (replay.status < 300 && replay.json('jobId') !== res.json('jobId')) keyMismatch.add(1);
      }
      return;
    }
    if (!RETRYABLE(res.status)) {
      rejected4xx.add(1, { status: String(res.status) });
      console.error(`${payload.type} ${res.status}: ${res.body}`);
      return;
    }
    if (attempt === BACKOFF_SECONDS.length) {
      gaveUp.add(1, { status: String(res.status) });
      return;
    }
    retries.add(1, { status: String(res.status) });
    sleep(retryAfter(res, attempt));
  }
}
