import { type Rendition, RENDITION_NAMES, RENDITIONS } from '@pdp/contracts';
import { PermanentError } from '@pdp/worker-kit';

/**
 * Peak video bitrate of each rendition. CRF keeps simple scenes small; the cap keeps a noisy
 * one streamable. The buffer is twice the cap, the usual VBV setting for VOD.
 */
const MAX_VIDEO_KBPS: Record<Rendition, number> = { '480p': 1500, '720p': 3000 };
const CRF = 23;
const PRESET = 'veryfast';
const AUDIO_KBPS = 128;

export interface RenditionTarget {
  rendition: Rendition;
  /** Shorter side, px. */
  size: number;
}

export interface RenditionOutput extends RenditionTarget {
  path: string;
}

export interface RenditionPlan {
  targets: RenditionTarget[];
  skipped: Rendition[];
}

/**
 * Keeps the requested renditions the source is large enough for, smallest first. The
 * shorter side decides, so a portrait 1080x1920 phone video still gets its 720p.
 */
export function planRenditions(
  source: { width: number; height: number },
  requested: readonly Rendition[],
): RenditionPlan {
  const shorter = Math.min(source.width, source.height);
  const ordered = RENDITION_NAMES.filter((r) => requested.includes(r));
  const targets = ordered
    .filter((r) => RENDITIONS[r] <= shorter)
    .map((rendition) => ({ rendition, size: RENDITIONS[rendition] }));
  if (targets.length === 0) {
    throw new PermanentError(
      `video is ${source.width}x${source.height}, smaller than ${ordered.join(', ')}; it is not upscaled`,
    );
  }
  return { targets, skipped: ordered.filter((r) => RENDITIONS[r] > shorter) };
}

/**
 * One decode, one `split` per rendition, one MP4 each: decoding is a large share of the CPU,
 * so two passes would cost almost twice as much. `-2` keeps the aspect ratio with an even
 * dimension, which yuv420p requires. Audio is optional (`0:a:0?`); `+faststart` moves the
 * index to the front so a browser starts playing before the download ends.
 */
export function transcodeArgs(
  source: string,
  outputs: readonly RenditionOutput[],
  landscape: boolean,
): string[] {
  const scale = (size: number) => (landscape ? `scale=-2:${size}` : `scale=${size}:-2`);
  const graph =
    outputs.length === 1
      ? `[0:v]${scale(outputs[0]!.size)}[v0]`
      : [
          `[0:v]split=${outputs.length}${outputs.map((_, i) => `[s${i}]`).join('')}`,
          ...outputs.map((o, i) => `[s${i}]${scale(o.size)}[v${i}]`),
        ].join(';');

  return [
    '-progress',
    'pipe:1',
    '-nostats',
    '-i',
    source,
    '-filter_complex',
    graph,
    ...outputs.flatMap((o, i) => {
      const kbps = MAX_VIDEO_KBPS[o.rendition];
      return [
        '-map',
        `[v${i}]`,
        '-map',
        '0:a:0?',
        '-c:v',
        'libx264',
        '-preset',
        PRESET,
        '-crf',
        String(CRF),
        '-maxrate',
        `${kbps}k`,
        '-bufsize',
        `${kbps * 2}k`,
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        `${AUDIO_KBPS}k`,
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        o.path,
      ];
    }),
  ];
}

/**
 * Reads `-progress` output: blocks of `key=value` lines, each closed by `progress=continue`
 * or `progress=end`. Returns the encoded position at the end of every complete block.
 */
export class ProgressParser {
  private buffer = '';
  private outTimeUs: number | undefined;

  feed(chunk: string): number[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    const positions: number[] = [];
    for (const line of lines) {
      const [key, value] = line.trim().split('=', 2);
      if (key === 'out_time_us') {
        const us = Number(value);
        if (Number.isFinite(us) && us >= 0) this.outTimeUs = us;
      } else if (key === 'progress' && this.outTimeUs !== undefined) {
        positions.push(this.outTimeUs / 1_000_000);
      }
    }
    return positions;
  }
}
