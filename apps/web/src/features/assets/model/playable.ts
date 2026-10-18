import { type AssetJob, type AssetRendition } from './types';

const byHeightDesc = (a: AssetRendition, b: AssetRendition) => b.height - a.height;

/** The newest transcode's renditions, best first, and a frame to show before playback. */
export function playableOf(jobs: readonly AssetJob[]): {
  renditions: AssetRendition[];
  poster: string | null;
} {
  const done = jobs.filter((job) => job.status === 'succeeded');
  const transcode = done.find((job) => job.transcode)?.transcode;
  const poster =
    done.map((job) => job.transcode?.preview ?? job.video?.preview).find(Boolean)?.url ?? null;
  return { renditions: [...(transcode?.renditions ?? [])].sort(byHeightDesc), poster };
}
