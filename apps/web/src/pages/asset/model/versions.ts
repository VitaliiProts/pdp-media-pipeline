import {
  type AssetFrame,
  type AssetImageVersion,
  type AssetJob,
  type AssetRendition,
} from '../../../features/assets';

type Download = Pick<AssetImageVersion, 'url' | 'downloadUrl'>;
type Size = { width: number; height: number; bytes: number };

export type Version =
  | ({ id: string; kind: 'image'; preset: string } & Size & Download)
  | ({ id: string; kind: 'rendition'; rendition: string } & Size & Download)
  | ({ id: string; kind: 'preview' } & Size & Download);

const succeeded = (jobs: readonly AssetJob[]) => jobs.filter((job) => job.status === 'succeeded');
const byHeightDesc = (a: AssetRendition, b: AssetRendition) => b.height - a.height;

/** Jobs come newest first from the gateway; versions keep that order. */
export function versionsOf(jobs: readonly AssetJob[]): Version[] {
  return succeeded(jobs).flatMap((job): Version[] => {
    const preview = job.video?.preview ?? job.transcode?.preview;
    return [
      ...(job.results ?? []).map(({ preset, width, height, bytes, url, downloadUrl }) => ({
        id: `${job.id}:${preset}`,
        kind: 'image' as const,
        preset,
        width,
        height,
        bytes,
        url,
        downloadUrl,
      })),
      ...[...(job.transcode?.renditions ?? [])]
        .sort(byHeightDesc)
        .map(({ rendition, width, height, bytes, url, downloadUrl }) => ({
          id: `${job.id}:${rendition}`,
          kind: 'rendition' as const,
          rendition,
          width,
          height,
          bytes,
          url,
          downloadUrl,
        })),
      ...(preview
        ? [
            {
              id: `${job.id}:preview`,
              kind: 'preview' as const,
              width: preview.width,
              height: preview.height,
              bytes: preview.bytes,
              url: preview.url,
              downloadUrl: preview.downloadUrl,
            },
          ]
        : []),
    ];
  });
}

export function framesOf(jobs: readonly AssetJob[]): AssetFrame[] {
  return succeeded(jobs).find((job) => job.video)?.video?.frames ?? [];
}

/** The newest transcode's renditions, best first, and a frame to show before playback. */
export function playableOf(jobs: readonly AssetJob[]): {
  renditions: AssetRendition[];
  poster: string | null;
} {
  const done = succeeded(jobs);
  const transcode = done.find((job) => job.transcode)?.transcode;
  const poster =
    done.map((job) => job.transcode?.preview ?? job.video?.preview).find(Boolean)?.url ?? null;
  return { renditions: [...(transcode?.renditions ?? [])].sort(byHeightDesc), poster };
}

const FORMAT_NAME: Record<string, string> = {
  webp: 'WebP',
  jpg: 'JPEG',
  jpeg: 'JPEG',
  mp4: 'MP4',
  png: 'PNG',
};

export function formatOf(url: string): string {
  const { pathname } = new URL(url);
  const extension = pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase();
  return FORMAT_NAME[extension] ?? extension.toUpperCase();
}
