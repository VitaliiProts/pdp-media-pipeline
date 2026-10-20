import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  DEFAULT_JOB_PRIORITY,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENT_REPLAYED_HEADER,
  ImageResizeInputV1,
  type JobDto,
  MEDIA_JOB_TYPES,
  selectClass,
  uploadKeyPrefix,
  VideoDubInputV1,
  VideoFramesInputV1,
  VideoTranscodeInputV1,
} from '@pdp/contracts';
import { EgressClient } from '@pdp/egress';
import { MetadataClient, MetadataError } from '@pdp/metadata-client';
import { type Response } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { UserId } from '../auth/user';
import { BackpressureService } from '../backpressure/backpressure.service';
import { assertPublicUrl } from '../common/public-url';
import { type Env } from '../config';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { StorageService } from '../storage/storage.service';
import { JobPresenter } from './job-presenter';
import {
  type CreatableJobType,
  CreateJobDto,
  CreateJobResponseDto,
  JobResponseDto,
  ListJobsQueryDto,
  ListJobsResponseDto,
} from './jobs.dto';

const REDRIVE_ACTOR = (userId: string) => `user:${userId}`;

@ApiTags('jobs')
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded, see Retry-After' })
@UseGuards(AuthGuard, RateLimitGuard)
@Controller('v1/jobs')
export class JobsController {
  private readonly maxBytes: Record<CreatableJobType, number>;

  constructor(
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly storage: StorageService,
    private readonly presenter: JobPresenter,
    private readonly backpressure: BackpressureService,
    private readonly egress: EgressClient,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = {
      'image.resize': config.get('MAX_UPLOAD_BYTES', { infer: true }),
      'video.frames': config.get('MAX_VIDEO_UPLOAD_BYTES', { infer: true }),
      'video.transcode': config.get('MAX_VIDEO_UPLOAD_BYTES', { infer: true }),
      'video.dub': config.get('MAX_VIDEO_UPLOAD_BYTES', { infer: true }),
    };
  }

  @Post()
  @HttpCode(202)
  @ApiAcceptedResponse({ type: CreateJobResponseDto })
  @ApiServiceUnavailableResponse({ description: 'The queue for this job is full, see Retry-After' })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: false,
    description:
      'Repeating a request with the same key within 24 hours returns the first response ' +
      `(marked ${IDEMPOTENT_REPLAYED_HEADER}: true) instead of creating another job.`,
  })
  @ApiConflictResponse({ description: 'A request with this Idempotency-Key is still in progress' })
  @ApiUnprocessableEntityResponse({
    description: 'This Idempotency-Key was already used with a different body',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded (see Retry-After), or code DUB_QUOTA_EXCEEDED: the dub seconds of ' +
      'this month are used up; DUB_SYSTEM_QUOTA_EXCEEDED: those of the whole service are',
  })
  async create(
    @UserId() userId: string,
    @Body() body: CreateJobDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateJobResponseDto> {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException(
        `${IDEMPOTENCY_KEY_HEADER} must be 1-255 printable ASCII characters`,
      );
    }
    const priority = body.priority ?? DEFAULT_JOB_PRIORITY;
    await this.backpressure.assertAccepting(selectClass({ type: body.type, priority }));

    const input = jobInput(body);
    if (body.sourceKey !== undefined) await this.assertUploaded(userId, body.sourceKey, body.type);
    if (body.sourceUrl !== undefined) {
      await assertPublicUrl(this.egress, body.sourceUrl, 'sourceUrl');
    }

    const { job, replayed } = await this.metadata.createJob({
      userId,
      type: body.type,
      priority,
      input,
      idempotency: idempotencyKey
        ? { key: idempotencyKey, requestHash: requestHash({ type: body.type, priority, input }) }
        : undefined,
    });
    if (replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return { jobId: job.id, status: job.status };
  }

  @Get()
  @ApiOkResponse({ type: ListJobsResponseDto })
  async list(
    @UserId() userId: string,
    @Query() query: ListJobsQueryDto,
  ): Promise<ListJobsResponseDto> {
    // Webhook deliveries are jobs too, but they are listed per endpoint under /v1/webhooks.
    const page = await this.metadata.listJobs({ userId, ...query, types: [...MEDIA_JOB_TYPES] });
    return {
      items: await Promise.all(page.items.map((job) => this.presenter.toResponse(job))),
      nextCursor: page.nextCursor,
    };
  }

  /** A job of another user is reported as missing, so ids cannot be probed. */
  @Get(':id')
  @ApiOkResponse({ type: JobResponseDto })
  async get(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobResponseDto> {
    return this.presenter.toResponse(await this.ownJob(userId, id));
  }

  /** Sends a dead job through the pipeline again; its earlier attempts stay in the history. */
  @Post(':id/redrive')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: JobResponseDto })
  @ApiConflictResponse({ description: 'Only a dead job can be redriven' })
  @ApiServiceUnavailableResponse({ description: 'The queue for this job is full, see Retry-After' })
  async redrive(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobResponseDto> {
    const job = await this.ownJob(userId, id);
    await this.backpressure.assertAccepting(
      job.class ?? selectClass({ type: job.type, priority: job.priority }),
    );
    return this.presenter.toResponse(
      await this.metadata.redrive(id, { actor: REDRIVE_ACTOR(userId) }),
    );
  }

  private async assertUploaded(userId: string, key: string, type: CreatableJobType): Promise<void> {
    if (!key.startsWith(uploadKeyPrefix(userId)) || key.includes('..')) {
      throw new BadRequestException('sourceKey must come from POST /v1/uploads');
    }
    const object = await this.storage.headObject(key);
    if (!object) throw new BadRequestException('source object not found; upload it first');
    const maxBytes = this.maxBytes[type];
    if (object.size > maxBytes) {
      throw new PayloadTooLargeException(`file exceeds ${maxBytes} bytes`);
    }
  }

  private async ownJob(userId: string, id: string): Promise<JobDto> {
    const job = await this.metadata.getJob(id).catch((err: unknown) => {
      if (err instanceof MetadataError && err.status === 404) return null;
      throw err;
    });
    if (!job || job.userId !== userId) throw new NotFoundException(`job ${id} not found`);
    return job;
  }
}

/** Validated against the same schema Metadata uses, so defaults are part of the request hash. */
function jobInput(body: CreateJobDto): Record<string, unknown> {
  const source = Object.fromEntries(
    Object.entries({ sourceKey: body.sourceKey, sourceUrl: body.sourceUrl }).filter(
      ([, value]) => value !== undefined,
    ),
  );
  const parsed = (() => {
    switch (body.type) {
      case 'image.resize':
        return ImageResizeInputV1.safeParse({ ...source, presets: body.presets });
      case 'video.frames':
        return VideoFramesInputV1.safeParse({
          ...source,
          intervalSeconds: body.intervalSeconds,
          maxFrames: body.maxFrames,
        });
      case 'video.transcode':
        return VideoTranscodeInputV1.safeParse({ ...source, renditions: body.renditions });
      case 'video.dub':
        // The quota counts the duration of a known asset, so never a URL.
        if (body.sourceUrl !== undefined) {
          throw new BadRequestException('video.dub takes a sourceKey from the media library');
        }
        return VideoDubInputV1.safeParse({
          sourceKey: body.sourceKey,
          targetLanguage: body.targetLanguage,
          sourceLanguage: body.sourceLanguage,
          speakers: body.speakers,
          reuseOf: body.reuseOf,
        });
    }
  })();
  if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
  return parsed.data;
}

/** Same body, same hash: keys are sorted so property order does not matter. */
function requestHash(body: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
