import { ASSETS_PAGE_SIZE, type AssetSummary } from '../../../features/assets';
import { type Upload } from '../../../features/upload';

type Submitted = Extract<Upload, { phase: 'submitted' }>;

const jobIdsOf = (assets: readonly AssetSummary[]) =>
  new Set(assets.flatMap((asset) => (asset.latestJob ? [asset.latestJob.id] : [])));

/**
 * Submitted uploads whose file can still turn up on the first page of the unfiltered list:
 * not listed yet, and among the newest page-full, since every newer upload makes a newer file.
 */
function awaited(uploads: readonly Upload[]): Submitted[] {
  return uploads
    .filter((upload): upload is Submitted => upload.phase === 'submitted' && !upload.listed)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, ASSETS_PAGE_SIZE);
}

/** Jobs whose files the library is still waiting for. */
export function awaitedJobIds(uploads: readonly Upload[]): string[] {
  return awaited(uploads).map((upload) => upload.jobId);
}

/** Local uploads the server list does not show yet; the slice keeps them for /jobs. */
export function pendingUploads(
  uploads: readonly Upload[],
  assets: readonly AssetSummary[],
): Upload[] {
  const awaitedIds = new Set(awaited(uploads).map((upload) => upload.id));
  const listedJobs = jobIdsOf(assets);
  return uploads.filter(
    (upload) =>
      upload.phase !== 'submitted' || (awaitedIds.has(upload.id) && !listedJobs.has(upload.jobId)),
  );
}

/** Jobs of submitted uploads that the list shows for the first time. */
export function newlyListedJobIds(
  uploads: readonly Upload[],
  assets: readonly AssetSummary[],
): string[] {
  const listedJobs = jobIdsOf(assets);
  return uploads.flatMap((upload) =>
    upload.phase === 'submitted' && !upload.listed && listedJobs.has(upload.jobId)
      ? [upload.jobId]
      : [],
  );
}
