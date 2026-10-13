import { check, fail } from 'k6';
import http from 'k6/http';

export const BASE_URL = __ENV.BASE_URL || 'http://api-gateway:3000';

/**
 * Presigned URLs are signed for the host the browser uses (localhost:<port>), while
 * k6 runs inside the compose network. Requests go to STORAGE_URL but keep the signed
 * Host header so the SigV4 signature still matches.
 */
const STORAGE_URL = __ENV.STORAGE_URL || 'http://minio:9000';

/** Deterministic perf users seeded by scripts/perf.sh: pdp_perf_01_local, ... */
export function apiKey(n) {
  return `pdp_perf_${String(n).padStart(2, '0')}_local`;
}

export const USER_COUNT = Number(__ENV.USERS || 30);

export function headers(key, extra = {}) {
  return { 'x-api-key': key, 'content-type': 'application/json', ...extra };
}

const source = open('../fixtures/source.png', 'b');

/** Uploads the PNG fixture for a user and returns its sourceKey. Run from setup(). */
export function uploadSource(key) {
  return uploadFile(key, source, 'image/png');
}

/** Uploads `body` through a presigned URL and returns its sourceKey. Run from setup(). */
export function uploadFile(key, body, contentType) {
  const res = http.post(
    `${BASE_URL}/v1/uploads`,
    JSON.stringify({ contentType, size: body.byteLength }),
    { headers: headers(key), tags: { name: 'setup' } },
  );
  if (res.status !== 200) fail(`POST /v1/uploads: ${res.status} ${res.body}`);
  const { uploadUrl, sourceKey } = res.json();

  // k6 has no global URL.
  const [, host, pathAndQuery] = /^https?:\/\/([^/]+)(\/.*)$/.exec(uploadUrl);
  const put = http.put(`${STORAGE_URL}${pathAndQuery}`, body, {
    headers: { 'content-type': contentType, Host: host },
    tags: { name: 'setup' },
  });
  if (put.status !== 200) fail(`PUT presigned: ${put.status} ${put.body}`);
  return sourceKey;
}

export function createJob(key, sourceKey, { priority, tags = {} } = {}) {
  return http.post(
    `${BASE_URL}/v1/jobs`,
    JSON.stringify({
      type: 'image.resize',
      sourceKey,
      presets: ['thumb'],
      ...(priority === undefined ? {} : { priority }),
    }),
    { headers: headers(key), tags: { name: 'POST /v1/jobs', ...tags } },
  );
}

/** Sets up one uploaded source and one job per user; GET /v1/jobs/:id needs a real id. */
export function seedUsers(count) {
  const users = [];
  for (let n = 1; n <= count; n++) {
    const key = apiKey(n);
    const sourceKey = uploadSource(key);
    const res = createJob(key, sourceKey, { tags: { name: 'setup' } });
    if (res.status !== 202) fail(`POST /v1/jobs: ${res.status} ${res.body}`);
    users.push({ key, sourceKey, jobId: res.json('jobId') });
  }
  return users;
}

/** A 429/503 must say when to come back. */
export function checkRetryAfter(res) {
  if (res.status !== 429 && res.status !== 503) return;
  check(res, {
    [`${res.status} has Retry-After >= 1`]: (r) => Number(r.headers['Retry-After']) >= 1,
  });
}
