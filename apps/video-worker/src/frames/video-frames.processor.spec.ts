import { isPermanentError, PermanentError } from '@pdp/worker-kit';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type VideoFramesDeps, VideoFramesProcessor } from './video-frames.processor';

/** Minimal JPEG header for a 640x360 frame. */
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x68, 0x02, 0x80, 0x03]);

async function setup(frameCount = 3) {
  const workDir = await mkdtemp(join(tmpdir(), 'video-frames-spec-'));
  const deps = {
    download: jest.fn<
      ReturnType<VideoFramesDeps['download']>,
      Parameters<VideoFramesDeps['download']>
    >((_source, path) => writeFile(path, 'video')),
    probe: jest.fn<ReturnType<VideoFramesDeps['probe']>, Parameters<VideoFramesDeps['probe']>>(() =>
      Promise.resolve({ durationSeconds: 5, width: 1280, height: 720, codec: 'h264' }),
    ),
    extractPreview: jest.fn<
      ReturnType<VideoFramesDeps['extractPreview']>,
      Parameters<VideoFramesDeps['extractPreview']>
    >((_source, output) => writeFile(output, jpeg)),
    extractFrames: jest.fn<
      ReturnType<VideoFramesDeps['extractFrames']>,
      Parameters<VideoFramesDeps['extractFrames']>
    >(async (_source, dir) => {
      const paths = Array.from({ length: frameCount }, (_, i) =>
        join(dir, `frame-000${i + 1}.jpg`),
      );
      await Promise.all(paths.map((p) => writeFile(p, jpeg)));
      return paths;
    }),
    putObject: jest.fn<Promise<void>, [string, Buffer, string]>(() => Promise.resolve()),
  };
  const processor = new VideoFramesProcessor(deps, {
    maxSourceBytes: 1000,
    downloadTimeoutMs: 5000,
    workDir,
  });
  return { deps, processor, workDir };
}

describe('VideoFramesProcessor', () => {
  it('uploads a preview and interval frames under deterministic keys', async () => {
    const { deps, processor } = await setup();
    const output = await processor.process(
      { jobId: 'j1', attempt: 1 },
      { sourceUrl: 'https://cdn.example/v.mp4', intervalSeconds: 2, maxFrames: 10 },
    );

    expect(deps.download).toHaveBeenCalledWith(
      { kind: 'url', url: 'https://cdn.example/v.mp4' },
      expect.any(String),
      { maxBytes: 1000, timeoutMs: 5000 },
    );
    expect(deps.extractFrames).toHaveBeenCalledWith(expect.any(String), expect.any(String), 2, 10);
    expect(deps.extractPreview.mock.calls[0]?.[2]).toBe(1);
    expect(deps.putObject.mock.calls.map(([key, , type]) => [key, type])).toEqual([
      ['results/j1/preview.jpg', 'image/jpeg'],
      ['results/j1/frames/0001.jpg', 'image/jpeg'],
      ['results/j1/frames/0002.jpg', 'image/jpeg'],
      ['results/j1/frames/0003.jpg', 'image/jpeg'],
    ]);
    expect(output).toMatchObject({
      durationSeconds: 5,
      width: 1280,
      height: 720,
      codec: 'h264',
      preview: { key: 'results/j1/preview.jpg', atSeconds: 1, width: 640, height: 360 },
    });
    expect(output.frames.map((f) => f.atSeconds)).toEqual([0, 2, 4]);
    expect(output.frames[0]).toMatchObject({ width: 640, height: 360, bytes: jpeg.length });
  });

  it('takes the preview from the middle of very short videos', async () => {
    const { deps, processor } = await setup();
    deps.probe.mockResolvedValueOnce({ durationSeconds: 1, width: 64, height: 64, codec: 'vp9' });
    await processor.process(
      { jobId: 'j1', attempt: 1 },
      { sourceKey: 'k', intervalSeconds: 2, maxFrames: 1 },
    );
    expect(deps.extractPreview.mock.calls[0]?.[2]).toBe(0.5);
  });

  it('removes the scratch directory after success and after failure', async () => {
    const ok = await setup();
    await ok.processor.process(
      { jobId: 'j1', attempt: 1 },
      { sourceKey: 'k', intervalSeconds: 2, maxFrames: 3 },
    );
    expect(await readdir(ok.workDir)).toEqual([]);

    const failing = await setup();
    failing.deps.probe.mockRejectedValueOnce(new PermanentError('video is 61.0s, limit 60s'));
    await expect(
      failing.processor.process(
        { jobId: 'j2', attempt: 1 },
        { sourceKey: 'k', intervalSeconds: 2, maxFrames: 3 },
      ),
    ).rejects.toThrow('limit 60s');
    expect(failing.deps.extractFrames).not.toHaveBeenCalled();
    expect(await readdir(failing.workDir)).toEqual([]);
  });

  it('fails permanently when no frame could be decoded', async () => {
    const { processor } = await setup(0);
    const err = await processor
      .process({ jobId: 'j1', attempt: 1 }, { sourceKey: 'k', intervalSeconds: 2, maxFrames: 3 })
      .catch((e: unknown) => e);
    expect(isPermanentError(err)).toBe(true);
  });
});
