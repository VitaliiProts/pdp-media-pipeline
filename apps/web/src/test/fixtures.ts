import { type Asset, type AssetSummary } from '../features/assets';

export const TEST_EMAIL = 'dev@example.com';
export const TEST_PASSWORD = 'correct horse battery';

export const TEST_ME = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'dev',
  email: TEST_EMAIL,
  createdAt: '2026-10-01T10:00:00.000Z',
  authMethod: 'session',
} as const;

export const TEST_ASSET: Asset = {
  id: 'a0000000-0000-4000-8000-000000000001',
  kind: 'image',
  name: 'harbour.jpg',
  contentType: 'image/jpeg',
  size: 2_400_000,
  width: 1200,
  height: 800,
  durationSeconds: null,
  sourceKey: 'u/1/harbour',
  createdAt: '2026-10-14T10:00:00.000Z',
};

export const testAsset = (overrides: Partial<AssetSummary> = {}): AssetSummary => ({
  ...TEST_ASSET,
  preview: { url: 'http://storage.test/thumb.webp', width: 200, height: 133 },
  latestJob: {
    id: 'b0000000-0000-4000-8000-000000000001',
    type: 'image.resize',
    status: 'succeeded',
  },
  ...overrides,
});
