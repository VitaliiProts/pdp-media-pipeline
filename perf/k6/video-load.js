import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import { apiKey, BASE_URL, headers, uploadFile } from './lib/common.js';

/**
 * Stage 5.3 demo in the k3d cluster (scripts/autoscale-demo.sh): video jobs arrive faster
 * than one pod can take them, so KEDA scales video-transcode and video-frames out, the
 * demo restarts them under load, and they scale back in once the queue is empty.
 *
 * One 1080p transcode of the fixture takes about 20 s on a pod's 2 CPUs; 12 a minute need
 * four pods. Frames jobs take a few seconds each and keep the second deployment busy.
 */
const USERS = 3;
const RAMP = __ENV.RAMP || '1m';
const HOLD = __ENV.HOLD || '5m';
const TRANSCODES_PER_MIN = Number(__ENV.TRANSCODES_PER_MIN || 12);
const FRAMES_PER_MIN = Number(__ENV.FRAMES_PER_MIN || 20);

const video = open('./fixtures/video.mp4', 'b');

const load = (perMinute, execName) => ({
  executor: 'ramping-arrival-rate',
  startRate: 0,
  timeUnit: '1m',
  preAllocatedVUs: 4,
  stages: [
    { target: perMinute, duration: RAMP },
    { target: perMinute, duration: HOLD },
  ],
  exec: execName,
});

export const options = {
  scenarios: {
    transcode: load(TRANSCODES_PER_MIN, 'transcode'),
    frames: load(FRAMES_PER_MIN, 'frames'),
  },
  thresholds: {
    'checks{check:accepted}': ['rate>0.99'],
  },
};

export function setup() {
  const users = [];
  for (let n = 1; n <= USERS; n++) {
    const key = apiKey(n);
    users.push({ key, sourceKey: uploadFile(key, video, 'video/mp4') });
  }
  return { users };
}

const user = (data) => data.users[exec.scenario.iterationInTest % data.users.length];

const create = (key, body, name) =>
  check(
    http.post(`${BASE_URL}/v1/jobs`, JSON.stringify(body), {
      headers: headers(key),
      tags: { name },
    }),
    { accepted: (r) => r.status === 202 },
  );

export function transcode(data) {
  const { key, sourceKey } = user(data);
  create(key, { type: 'video.transcode', sourceKey }, 'POST /v1/jobs (video.transcode)');
}

export function frames(data) {
  const { key, sourceKey } = user(data);
  create(key, { type: 'video.frames', sourceKey }, 'POST /v1/jobs (video.frames)');
}
