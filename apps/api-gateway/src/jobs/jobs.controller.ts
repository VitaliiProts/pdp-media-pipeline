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
  API_KEY_HEADER,
  DEFAULT_JOB_PRIORITY,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENT_REPLAYED_HEADER,
  ImageResizeOutputV1,
  type JobDto,
  selectClass,
  uploadKeyPrefix,
} from '@pdp/contracts';
import { MetadataClient, MetadataError } from '@pdp/metadata-client';
import { type Response } from 'express';
import { createHash } from 'node:crypto';
import { ApiKeyGuard, UserId } from '../auth/api-key.guard';
import { BackpressureService } from '../backpressure/backpressure.service';
import { type Env } from '../config';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { StorageService } from '../storage/storage.service';
import {
  CreateJobDto,
  CreateJobResponseDto,
  JobResponseDto,
  ListJobsQueryDto,
  ListJobsResponseDto,
} from './jobs.dto';

export const RESULT_URL_TTL_S = 60 * 60;

const REDRIVE_ACTOR = (userId: string) => `user:${userId}`;

@ApiTags('jobs')
@ApiHeader({ name: API_KEY_HEADER, required: true })
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded, see Retry-After' })
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('v1/jobs')
export class JobsController {
  private readonly maxBytes: number;

  constructor(
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly storage: StorageService,
    private readonly backpressure: BackpressureService,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.get('MAX_UPLOAD_BYTES', { infer: true });
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

    if (!body.sourceKey.startsWith(uploadKeyPrefix(userId)) || body.sourceKey.includes('..')) {
      throw new BadRequestException('sourceKey must come from POST /v1/uploads');
    }
    const object = await this.storage.headObject(body.sourceKey);
    if (!object) throw new BadRequestException('source object not found; upload it first');
    if (object.size > this.maxBytes) {
      throw new PayloadTooLargeException(`file exceeds ${this.maxBytes} bytes`);
    }

    const input = { sourceKey: body.sourceKey, presets: body.presets };
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
    const page = await this.metadata.listJobs({ userId, ...query });
    return {
      items: await Promise.all(page.items.map((job) => this.toResponse(job))),
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
    return this.toResponse(await this.ownJob(userId, id));
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
    return this.toResponse(await this.metadata.redrive(id, { actor: REDRIVE_ACTOR(userId) }));
  }

  private async ownJob(userId: string, id: string): Promise<JobDto> {
    const job = await this.metadata.getJob(id).catch((err: unknown) => {
      if (err instanceof MetadataError && err.status === 404) return null;
      throw err;
    });
    if (!job || job.userId !== userId) throw new NotFoundException(`job ${id} not found`);
    return job;
  }

  /** Presigning is a local HMAC, so result URLs are cheap enough to include in lists too. */
  private async toResponse(job: JobDto): Promise<JobResponseDto> {
    const response: JobResponseDto = {
      id: job.id,
      type: job.type,
      status: job.status,
      priority: job.priority,
      input: job.input,
      attempts: job.attempts,
      lastError: job.lastError,
      deadReason: job.deadReason,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt,
    };
    if (job.status !== 'succeeded') return response;

    const output = ImageResizeOutputV1.safeParse(job.output);
    if (!output.success) return response;
    response.results = await Promise.all(
      output.data.results.map(async ({ key, ...result }) => ({
        ...result,
        url: await this.storage.presignGet(key, RESULT_URL_TTL_S),
      })),
    );
    return response;
  }
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
