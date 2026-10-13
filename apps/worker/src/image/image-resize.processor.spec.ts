import { type ImagePreset, type MediaSource } from '@pdp/contracts';
import { type FetchLimits } from '@pdp/worker-kit';
import { ImageResizeProcessor } from './image-resize.processor';
import { type ResizedImage } from './resize';

function setup() {
  const deps = {
    fetchSource: jest.fn<Promise<Buffer>, [MediaSource, FetchLimits]>(() =>
      Promise.resolve(Buffer.from('src')),
    ),
    putObject: jest.fn<Promise<void>, [string, Buffer, string]>(() => Promise.resolve()),
    resize: jest.fn<Promise<ResizedImage[]>, [Buffer, readonly ImagePreset[]]>((_input, presets) =>
      Promise.resolve(
        presets.map((preset) => ({ preset, width: 10, height: 5, data: Buffer.from(preset) })),
      ),
    ),
  };
  return { deps, processor: new ImageResizeProcessor(deps, 1000) };
}

describe('ImageResizeProcessor', () => {
  it('stores every preset under a deterministic key', async () => {
    const { deps, processor } = setup();
    const output = await processor.process(
      { jobId: 'j1', attempt: 1, progress: () => undefined, signal: new AbortController().signal },
      { sourceKey: 'uploads/u/a.png', presets: ['thumb', 'medium'] },
    );

    expect(deps.fetchSource).toHaveBeenCalledWith(
      { kind: 'key', key: 'uploads/u/a.png' },
      { maxBytes: 1000 },
    );
    expect(deps.putObject.mock.calls.map(([key, , type]) => [key, type])).toEqual([
      ['results/j1/thumb.webp', 'image/webp'],
      ['results/j1/medium.webp', 'image/webp'],
    ]);
    expect(output.results).toEqual([
      { preset: 'thumb', key: 'results/j1/thumb.webp', width: 10, height: 5, bytes: 5 },
      { preset: 'medium', key: 'results/j1/medium.webp', width: 10, height: 5, bytes: 6 },
    ]);
  });

  it('fetches a URL source through the egress path', async () => {
    const { deps, processor } = setup();
    await processor.process(
      { jobId: 'j1', attempt: 1, progress: () => undefined, signal: new AbortController().signal },
      { sourceUrl: 'https://cdn.example/a.png', presets: ['thumb'] },
    );
    expect(deps.fetchSource).toHaveBeenCalledWith(
      { kind: 'url', url: 'https://cdn.example/a.png' },
      { maxBytes: 1000 },
    );
  });
});
