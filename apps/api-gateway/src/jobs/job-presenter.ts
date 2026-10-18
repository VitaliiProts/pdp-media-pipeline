import { Injectable } from '@nestjs/common';
import {
  ImageResizeOutputV1,
  type JobDto,
  type VideoFrame,
  VideoFramesOutputV1,
  VideoTranscodeOutputV1,
} from '@pdp/contracts';
import { StorageService } from '../storage/storage.service';
import { type JobResponseDto, type VideoFrameDto } from './jobs.dto';

export const RESULT_URL_TTL_S = 60 * 60;

export function originalNameOf({ name, key }: { name: string | null; key: string }): string {
  return name ?? key.slice(key.lastIndexOf('/') + 1);
}

function splitExtension(fileName: string): [base: string, extension: string] {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot + 1)] : [fileName, ''];
}

export function downloadNameOf(original: string, suffix: string, key: string): string {
  const [base] = splitExtension(original);
  const [, extension] = splitExtension(key.slice(key.lastIndexOf('/') + 1));
  return extension ? `${base}-${suffix}.${extension}` : `${base}-${suffix}`;
}

/** Public shape of a job, with presigned URLs for whatever it produced. */
@Injectable()
export class JobPresenter {
  constructor(private readonly storage: StorageService) {}

  /**
   * Presigning is a local HMAC, so result URLs are cheap enough to include in lists too.
   * `downloadBase` (the original's file name) adds a `downloadUrl` that saves under a
   * matching name; only the asset details ask for it.
   */
  async toResponse(
    job: JobDto,
    { downloadBase }: { downloadBase?: string } = {},
  ): Promise<JobResponseDto> {
    const link = async (key: string, suffix: string) => ({
      url: await this.presign(key),
      ...(downloadBase !== undefined && {
        downloadUrl: await this.storage.presignGet(key, RESULT_URL_TTL_S, {
          downloadName: downloadNameOf(downloadBase, suffix, key),
        }),
      }),
    });
    const frame = async ({ key, ...rest }: VideoFrame, suffix: string): Promise<VideoFrameDto> => ({
      ...rest,
      ...(await link(key, suffix)),
    });
    const frameSuffix = (index: number) => `frame-${String(index + 1).padStart(4, '0')}`;

    const response: JobResponseDto = {
      id: job.id,
      type: job.type,
      status: job.status,
      priority: job.priority,
      input: job.input,
      assetId: job.assetId,
      attempts: job.attempts,
      lastError: job.lastError,
      deadReason: job.deadReason,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt,
      traceId: job.traceId,
      // The last value of an earlier attempt would be stale once the job left `running`.
      progress: job.status === 'running' ? job.progress : null,
      progressStep: job.status === 'running' ? job.progressStep : null,
    };
    if (job.status !== 'succeeded') return response;

    if (job.type === 'image.resize') {
      const output = ImageResizeOutputV1.safeParse(job.output);
      if (!output.success) return response;
      response.results = await Promise.all(
        output.data.results.map(async ({ key, ...result }) => ({
          ...result,
          ...(await link(key, result.preset)),
        })),
      );
    }
    if (job.type === 'video.frames') {
      const output = VideoFramesOutputV1.safeParse(job.output);
      if (!output.success) return response;
      const { preview, frames, ...video } = output.data;
      response.video = {
        ...video,
        preview: await frame(preview, 'preview'),
        frames: await Promise.all(frames.map((f, index) => frame(f, frameSuffix(index)))),
      };
    }
    if (job.type === 'video.transcode') {
      const output = VideoTranscodeOutputV1.safeParse(job.output);
      if (!output.success) return response;
      const { preview, renditions, ...video } = output.data;
      response.transcode = {
        ...video,
        preview: await frame(preview, 'preview'),
        renditions: await Promise.all(
          renditions.map(async ({ key, ...rendition }) => ({
            ...rendition,
            ...(await link(key, rendition.rendition)),
          })),
        ),
      };
    }
    return response;
  }

  presign(key: string): Promise<string> {
    return this.storage.presignGet(key, RESULT_URL_TTL_S);
  }
}
