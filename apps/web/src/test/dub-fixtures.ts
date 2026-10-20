import { type AssetDetails, type AssetDub, type AssetJob } from '../features/assets';
import { TEST_ASSET } from './fixtures';
import { STORAGE_ORIGIN } from './server';

export const DUB_ASSET_ID = 'a0000000-0000-4000-8000-000000000001';
export const DUB_JOB_ID = 'd0000000-0000-4000-8000-000000000001';

export const TEST_DUB: AssetDub = {
  durationSeconds: 12.5,
  sourceLanguage: 'en',
  targetLanguage: 'de',
  video: {
    bytes: 2_400_000,
    url: `${STORAGE_ORIGIN}/dubbed.mp4`,
    downloadUrl: `${STORAGE_ORIGIN}/dubbed.mp4?download`,
  },
  subtitles: {
    url: `${STORAGE_ORIGIN}/dubbed.vtt`,
    downloadUrl: `${STORAGE_ORIGIN}/dubbed.vtt?download`,
  },
  speakers: [
    { id: 'A', gender: 'male', maleProbability: 0.81, voice: 'M1', seconds: 7.2 },
    { id: 'B', gender: 'female', maleProbability: 0.3, voice: 'F2', seconds: 3.1 },
  ],
  phrases: [
    {
      id: 'p1',
      turn: 't1',
      speaker: 'A',
      start: 0.5,
      end: 2.5,
      source: 'Where are you going?',
      target: 'Wohin gehst du?',
      placedStart: 0.5,
      placedEnd: 2.4,
      speed: 1,
      refitted: false,
    },
    {
      id: 'p2',
      turn: 't2',
      speaker: 'B',
      start: 4,
      end: 6,
      source: 'Home, before it rains.',
      target: 'Nach Hause, bevor es regnet.',
      placedStart: 4,
      placedEnd: 6.1,
      speed: 1.3,
      refitted: true,
    },
    {
      id: 'p3',
      turn: 't3',
      speaker: 'A',
      start: 6.2,
      end: 7,
      source: 'Wait for me.',
      target: 'Warte auf mich, bitte, ich komme gleich.',
      placedStart: 6.2,
      placedEnd: 12.9,
      speed: 1.4,
      refitted: true,
    },
  ],
  unrecognized: [{ start: 8, end: 9.5 }],
  stats: { phrases: 3, sped: 2, refitted: 2, overflowed: 1, meanEndErrorSeconds: 2.1 },
};

export const dubJob = (overrides: Partial<AssetJob> = {}): AssetJob => ({
  id: DUB_JOB_ID,
  type: 'video.dub',
  status: 'succeeded',
  input: { sourceKey: 'u/1/cliffs', targetLanguage: 'de', sourceLanguage: 'auto' },
  attempts: 1,
  lastError: null,
  deadReason: null,
  createdAt: '2026-10-18T10:00:00.000Z',
  traceId: null,
  dub: TEST_DUB,
  ...overrides,
});

export const dubAsset = (
  jobs: AssetJob[],
  overrides: Partial<AssetDetails> = {},
): AssetDetails => ({
  ...TEST_ASSET,
  kind: 'video',
  name: 'cliffs.mp4',
  contentType: 'video/mp4',
  width: 1920,
  height: 1080,
  durationSeconds: 12.5,
  sourceKey: 'u/1/cliffs',
  originalUrl: `${STORAGE_ORIGIN}/original.mp4`,
  originalDownloadUrl: `${STORAGE_ORIGIN}/original.mp4?download`,
  jobs,
  jobsNextCursor: null,
  ...overrides,
});

export const DUB_QUOTA = {
  usedSeconds: 600,
  limitSeconds: 1800,
  remainingSeconds: 1200,
  systemLimited: false,
  maxVideoSeconds: 60,
  resetsAt: '2026-11-01T00:00:00.000Z',
};
