import { type AssetSummary } from '../../../features/assets';
import { type Upload } from '../../../features/upload';

/** Local uploads the server list does not show yet; the slice keeps them for /jobs. */
export function pendingUploads(
  uploads: readonly Upload[],
  assets: readonly AssetSummary[],
): Upload[] {
  const listedJobs = new Set(
    assets.flatMap((asset) => (asset.latestJob ? [asset.latestJob.id] : [])),
  );
  return uploads.filter((upload) => upload.phase !== 'submitted' || !listedJobs.has(upload.jobId));
}
