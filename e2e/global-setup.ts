import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { MEDIA_DIR, PHOTO, VIDEO } from './support/media';

/* eslint-disable-next-line @typescript-eslint/no-require-imports -- the package only exports a path */
const ffmpeg = require('ffmpeg-static') as string;

const run = (args: string[]) => promisify(execFile)(ffmpeg, ['-v', 'error', '-y', ...args]);

/** Media the tests upload, made with the static ffmpeg from npm rather than committed. */
export default async function globalSetup(): Promise<void> {
  await mkdir(MEDIA_DIR, { recursive: true });
  await run(['-f', 'lavfi', '-i', 'testsrc=size=640x480', '-frames:v', '1', PHOTO]);
  // Long enough for two phrases of the fake recognition, which starts one every 3.5 s.
  await run([
    ...['-f', 'lavfi', '-i', 'testsrc=duration=8:size=320x240:rate=10'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=8'],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', VIDEO],
  ]);
}
