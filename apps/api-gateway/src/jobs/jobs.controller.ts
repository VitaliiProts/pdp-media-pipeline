import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiAcceptedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { API_KEY_HEADER, ImageResizeOutputV1, type JobDto, uploadKeyPrefix } from '@pdp/contracts';
import { MetadataClient, MetadataError } from '@pdp/metadata-client';
import { ApiKeyGuard, UserId } from '../auth/api-key.guard';
import { type Env } from '../config';
import { StorageService } from '../storage/storage.service';
import {
  CreateJobDto,
  CreateJobResponseDto,
  JobResponseDto,
  ListJobsQueryDto,
  ListJobsResponseDto,
} from './jobs.dto';

export const RESULT_URL_TTL_S = 60 * 60;

@ApiTags('jobs')
@ApiHeader({ name: API_KEY_HEADER, required: true })
@UseGuards(ApiKeyGuard)
@Controller('v1/jobs')
export class JobsController {
  private readonly maxBytes: number;

  constructor(
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.get('MAX_UPLOAD_BYTES', { infer: true });
  }

  @Post()
  @HttpCode(202)
  @ApiAcceptedResponse({ type: CreateJobResponseDto })
  async create(
    @UserId() userId: string,
    @Body() body: CreateJobDto,
  ): Promise<CreateJobResponseDto> {
    if (!body.sourceKey.startsWith(uploadKeyPrefix(userId)) || body.sourceKey.includes('..')) {
      throw new BadRequestException('sourceKey must come from POST /v1/uploads');
    }
    const object = await this.storage.headObject(body.sourceKey);
    if (!object) throw new BadRequestException('source object not found; upload it first');
    if (object.size > this.maxBytes) {
      throw new PayloadTooLargeException(`file exceeds ${this.maxBytes} bytes`);
    }

    const job = await this.metadata.createJob({
      userId,
      type: body.type,
      priority: body.priority,
      input: { sourceKey: body.sourceKey, presets: body.presets },
    });
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
    const job = await this.metadata.getJob(id).catch((err: unknown) => {
      if (err instanceof MetadataError && err.status === 404) return null;
      throw err;
    });
    if (!job || job.userId !== userId) throw new NotFoundException(`job ${id} not found`);
    return this.toResponse(job);
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
