import {
  imageResultKey,
  ImageResizeInputV1,
  type ImageResizeOutputV1,
  type ImagePreset,
  type MediaSource,
  mediaSourceOf,
} from '@pdp/contracts';
import { type FetchLimits, type JobContext, type JobProcessor } from '@pdp/worker-kit';
import { type ResizeResult } from './resize';

export interface ImageResizeDeps {
  fetchSource: (source: MediaSource, limits: FetchLimits) => Promise<Buffer>;
  putObject: (key: string, body: Buffer, contentType: string) => Promise<void>;
  resize: (input: Buffer, presets: readonly ImagePreset[]) => Promise<ResizeResult>;
}

export class ImageResizeProcessor implements JobProcessor<ImageResizeInputV1> {
  readonly type = 'image.resize';
  readonly inputSchema = ImageResizeInputV1;

  constructor(
    private readonly deps: ImageResizeDeps,
    private readonly maxSourceBytes: number,
  ) {}

  async process(job: JobContext, input: ImageResizeInputV1): Promise<ImageResizeOutputV1> {
    const source = await this.deps.fetchSource(mediaSourceOf(input), {
      maxBytes: this.maxSourceBytes,
    });
    const { source: original, images } = await this.deps.resize(source, input.presets);
    const results = await Promise.all(
      images.map(async (image) => {
        const key = imageResultKey(job.jobId, image.preset);
        await this.deps.putObject(key, image.data, 'image/webp');
        return {
          preset: image.preset,
          key,
          width: image.width,
          height: image.height,
          bytes: image.data.length,
        };
      }),
    );
    return { results, source: original };
  }
}
