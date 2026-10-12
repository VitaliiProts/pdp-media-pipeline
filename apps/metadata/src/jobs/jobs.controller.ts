import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  CreateJobRequest,
  type CreateJobResponse,
  type JobDto,
  ListJobsQuery,
  type ListJobsResponse,
  RedriveRequest,
  TransitionRequest,
  type TransitionResponse,
} from '@pdp/contracts';
import { type z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JobsService } from './jobs.service';

interface StatusResponse {
  status(code: number): unknown;
}

/** Internal API: reachable only inside the compose network / cluster, no auth. */
@Controller('internal/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** 201 for a new job, 200 when an Idempotency-Key replays an earlier one. */
  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateJobRequest)) body: CreateJobRequest,
    @Res({ passthrough: true }) res: StatusResponse,
  ): Promise<CreateJobResponse> {
    const result = await this.jobs.create(body);
    res.status(result.replayed ? 200 : 201);
    return result;
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(ListJobsQuery)) query: z.output<typeof ListJobsQuery>,
  ): Promise<ListJobsResponse> {
    return this.jobs.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<JobDto> {
    return this.jobs.get(id);
  }

  @Post(':id/transitions')
  @HttpCode(200)
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(TransitionRequest)) body: TransitionRequest,
  ): Promise<TransitionResponse> {
    return this.jobs.transition(id, body);
  }

  @Post(':id/redrive')
  @HttpCode(200)
  redrive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RedriveRequest)) body: RedriveRequest,
  ): Promise<JobDto> {
    return this.jobs.redrive(id, body);
  }
}
