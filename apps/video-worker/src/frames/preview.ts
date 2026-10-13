import { type VideoFrame, videoPreviewKey } from '@pdp/contracts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jpegSize } from '../ffmpeg/jpeg-size';

/** A second in: the first frame is often black or a fade-in. */
const PREVIEW_AT_SECONDS = 1;

export interface PreviewDeps {
  extractPreview: (source: string, output: string, atSeconds: number) => Promise<void>;
  putObject: (key: string, body: Buffer, contentType: string) => Promise<void>;
}

export async function uploadJpeg(
  deps: Pick<PreviewDeps, 'putObject'>,
  path: string,
  key: string,
  atSeconds: number,
): Promise<VideoFrame> {
  const data = await readFile(path);
  const { width, height } = jpegSize(data);
  await deps.putObject(key, data, 'image/jpeg');
  return { key, atSeconds, width, height, bytes: data.length };
}

/** Writes into `dir`, which the caller removes. */
export async function makePreview(
  deps: PreviewDeps,
  jobId: string,
  source: string,
  dir: string,
  durationSeconds: number,
): Promise<VideoFrame> {
  const path = join(dir, 'preview.jpg');
  const atSeconds = Math.min(PREVIEW_AT_SECONDS, durationSeconds / 2);
  await deps.extractPreview(source, path, atSeconds);
  return uploadJpeg(deps, path, videoPreviewKey(jobId), atSeconds);
}
