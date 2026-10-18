import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { DUB_MAX_DURATION_SECONDS } from '@pdp/contracts';
import { MetadataClient } from '@pdp/metadata-client';
import { AuthGuard } from '../auth/auth.guard';
import { UserId } from '../auth/user';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { DubQuotaResponseDto } from './jobs.dto';

@ApiTags('jobs')
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded, see Retry-After' })
@UseGuards(AuthGuard, RateLimitGuard)
@Controller('v1/dub-quota')
export class DubQuotaController {
  constructor(@Inject(MetadataClient) private readonly metadata: MetadataClient) {}

  /** What the video.dub create check would count now, to warn before the upload. */
  @Get()
  @ApiOkResponse({ type: DubQuotaResponseDto })
  async get(@UserId() userId: string): Promise<DubQuotaResponseDto> {
    const quota = await this.metadata.getDubQuota(userId);
    return {
      ...quota,
      remainingSeconds: Math.max(0, quota.limitSeconds - quota.usedSeconds),
      maxVideoSeconds: DUB_MAX_DURATION_SECONDS,
    };
  }
}
