export const ASSET_KINDS = ['image', 'video'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** What the latest job says about a file; the gateway filters by it. */
export const ASSET_STATUSES = ['processing', 'ready', 'failed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Mirrors `ASSET_SEARCH_MAX_LENGTH` in @pdp/contracts. */
export const ASSET_SEARCH_MAX_LENGTH = 100;

export type AssetJobStatus = 'queued' | 'scheduled' | 'running' | 'succeeded' | 'failed' | 'dead';

const ACTIVE: readonly AssetJobStatus[] = ['queued', 'scheduled', 'running'];
export const isActiveJobStatus = (status: AssetJobStatus): boolean => ACTIVE.includes(status);

export type Asset = {
  id: string;
  kind: AssetKind;
  name: string | null;
  contentType: string;
  size: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  sourceKey: string;
  createdAt: string;
};

export type AssetSummary = Asset & {
  preview: { url: string; width: number; height: number } | null;
  latestJob: { id: string; type: string; status: AssetJobStatus } | null;
};

export type AssetPage = { items: AssetSummary[]; nextCursor: string | null };

export type AssetFilters = { kind: AssetKind | null; status: AssetStatus | null; q: string };
