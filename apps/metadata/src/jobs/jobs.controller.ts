import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  CreateJobRequest,
  type JobDto,
  ListJobsQuery,
  type ListJobsResponse,
  TransitionRequest,
  type TransitionResponse,
} from '@pdp/contracts';
import { type z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JobsService } from './jobs.service';

/** Internal API: reachable only inside the compose network / cluster, no auth. */
@Controller('internal/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateJobRequest)) body: CreateJobRequest): Promise<JobDto> {
    return this.jobs.create(body);
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
}
