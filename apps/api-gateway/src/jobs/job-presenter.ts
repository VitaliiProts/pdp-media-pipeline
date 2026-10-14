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

/** Public shape of a job, with presigned URLs for whatever it produced. */
@Injectable()
export class JobPresenter {
  constructor(private readonly storage: StorageService) {}

  /** Presigning is a local HMAC, so result URLs are cheap enough to include in lists too. */
  async toResponse(job: JobDto): Promise<JobResponseDto> {
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
    };
    if (job.status !== 'succeeded') return response;

    if (job.type === 'image.resize') {
      const output = ImageResizeOutputV1.safeParse(job.output);
      if (!output.success) return response;
      response.results = await Promise.all(
        output.data.results.map(async ({ key, ...result }) => ({
          ...result,
          url: await this.presign(key),
        })),
      );
    }
    if (job.type === 'video.frames') {
      const output = VideoFramesOutputV1.safeParse(job.output);
      if (!output.success) return response;
      const { preview, frames, ...video } = output.data;
      response.video = {
        ...video,
        preview: await this.presignFrame(preview),
        frames: await Promise.all(frames.map((frame) => this.presignFrame(frame))),
      };
    }
    if (job.type === 'video.transcode') {
      const output = VideoTranscodeOutputV1.safeParse(job.output);
      if (!output.success) return response;
      const { preview, renditions, ...video } = output.data;
      response.transcode = {
        ...video,
        preview: await this.presignFrame(preview),
        renditions: await Promise.all(
          renditions.map(async ({ key, ...rendition }) => ({
            ...rendition,
            url: await this.presign(key),
          })),
        ),
      };
    }
    return response;
  }

  presign(key: string): Promise<string> {
    return this.storage.presignGet(key, RESULT_URL_TTL_S);
  }

  private async presignFrame({ key, ...frame }: VideoFrame): Promise<VideoFrameDto> {
    return { ...frame, url: await this.presign(key) };
  }
}
