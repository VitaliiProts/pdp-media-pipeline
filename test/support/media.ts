import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/* eslint-disable @typescript-eslint/no-require-imports -- the packages only export a path */
const ffmpegPath = require('ffmpeg-static') as string;
const ffprobePath = (require('@ffprobe-installer/ffprobe') as { path: string }).path;
/* eslint-enable @typescript-eslint/no-require-imports */

/** Static builds from npm, so tests do not depend on a system ffmpeg. */
export const FFMPEG_ENV = { FFMPEG_PATH: ffmpegPath, FFPROBE_PATH: ffprobePath };

/** An H.264 MP4 with a moving test pattern. */
export async function makeVideo(seconds: number, width = 320, height = 240): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'pdp-video-'));
  try {
    const out = join(dir, 'clip.mp4');
    await promisify(execFile)(ffmpegPath, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=${seconds}:size=${width}x${height}:rate=5`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-y',
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
