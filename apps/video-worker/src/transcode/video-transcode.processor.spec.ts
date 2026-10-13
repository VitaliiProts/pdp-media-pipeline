import { isPermanentError } from '@pdp/worker-kit';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RenditionOutput } from '../ffmpeg/transcode';
import { type VideoTranscodeDeps, VideoTranscodeProcessor } from './video-transcode.processor';

/** Minimal JPEG header for a 640x360 frame. */
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x68, 0x02, 0x80, 0x03]);
const HEIGHT_BY_PATH = /(\d+)p\.mp4$/;

async function setup(source = { width: 1920, height: 1080 }) {
  const workDir = await mkdtemp(join(tmpdir(), 'video-transcode-spec-'));
  const progress = jest.fn<void, [number]>();
  const deps = {
    download: jest.fn<Promise<void>, Parameters<VideoTranscodeDeps['download']>>((_source, path) =>
      writeFile(path, 'video'),
    ),
    probe: jest.fn(() =>
      Promise.resolve({ durationSeconds: 10, codec: 'h264' as const, ...source }),
    ),
    probeOutput: jest.fn((path: string) => {
      const height = Number(HEIGHT_BY_PATH.exec(path)?.[1]);
      return Promise.resolve({
        durationSeconds: 10,
        width: Math.round((height * 16) / 9 / 2) * 2,
        height,
        codec: 'h264' as const,
      });
    }),
    extractPreview: jest.fn((_source: string, output: string) => writeFile(output, jpeg)),
    transcode: jest.fn(
      async (
        _source: string,
        outputs: readonly RenditionOutput[],
        _probe: unknown,
        onProgress: (f: number) => void,
        _signal: AbortSignal,
      ) => {
        onProgress(0.5);
        onProgress(1);
        await Promise.all(outputs.map((o) => writeFile(o.path, 'mp4')));
      },
    ),
    uploadFile: jest.fn((_key: string, _path: string, _type: string) => Promise.resolve(1_250_000)),
    putObject: jest.fn((_key: string, _body: Buffer, _type: string) => Promise.resolve()),
  };
  const processor = new VideoTranscodeProcessor(deps, {
    maxSourceBytes: 1000,
    downloadTimeoutMs: 5000,
    workDir,
  });
  const job = { jobId: 'j1', attempt: 1, progress, signal: new AbortController().signal };
  return { deps, processor, workDir, job, progress };
}

describe('VideoTranscodeProcessor', () => {
  it('writes every rendition in one run and uploads them under deterministic keys', async () => {
    const { deps, processor, job } = await setup();
    const output = await processor.process(job, {
      sourceKey: 'uploads/u/v.mp4',
      renditions: ['720p', '480p'],
    });

    expect(deps.transcode).toHaveBeenCalledTimes(1);
    expect(deps.transcode.mock.calls[0]?.[1].map((o) => o.rendition)).toEqual(['480p', '720p']);
    expect(deps.transcode.mock.calls[0]?.[4]).toBe(job.signal);
    const uploads = deps.uploadFile.mock.calls.map(([key, , type]) => [key, type]);
    expect(uploads.sort()).toEqual([
      ['results/j1/480p.mp4', 'video/mp4'],
      ['results/j1/720p.mp4', 'video/mp4'],
    ]);
    expect(output).toMatchObject({
      durationSeconds: 10,
      width: 1920,
      height: 1080,
      codec: 'h264',
      preview: { key: 'results/j1/preview.jpg', atSeconds: 1 },
      skipped: [],
    });
    expect(output.renditions[1]).toEqual({
      rendition: '720p',
      key: 'results/j1/720p.mp4',
      width: 1280,
      height: 720,
      durationSeconds: 10,
      bytes: 1_250_000,
      bitrate: 1_000_000,
    });
  });

  it('reports encoding progress and leaves 100% to success', async () => {
    const { processor, job, progress } = await setup();
    await processor.process(job, { sourceKey: 'k', renditions: ['480p'] });
    expect(progress.mock.calls.map(([p]) => p)).toEqual([0, 50, 99]);
  });

  it('skips renditions larger than the source', async () => {
    const { deps, processor, job } = await setup({ width: 854, height: 480 });
    const output = await processor.process(job, { sourceKey: 'k', renditions: ['480p', '720p'] });
    expect(output.skipped).toEqual(['720p']);
    expect(output.renditions.map((r) => r.rendition)).toEqual(['480p']);
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('fails permanently before encoding when no rendition fits, and cleans up', async () => {
    const { deps, processor, job, workDir } = await setup({ width: 320, height: 240 });
    const err = await processor
      .process(job, { sourceKey: 'k', renditions: ['480p'] })
      .catch((e: unknown) => e);
    expect(isPermanentError(err)).toBe(true);
    expect(deps.transcode).not.toHaveBeenCalled();
    expect(await readdir(workDir)).toEqual([]);
  });
});
