import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import {
  ASSET_DETAIL_JOBS,
  type AssetDto as InternalAssetDto,
  type AssetSummaryDto as InternalAssetSummaryDto,
  MEDIA_JOB_TYPES,
} from '@pdp/contracts';
import { MetadataClient } from '@pdp/metadata-client';
import { AuthGuard } from '../auth/auth.guard';
import { UserId } from '../auth/user';
import { JobPresenter } from '../jobs/job-presenter';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import {
  AssetDetailsDto,
  type AssetDto,
  type AssetSummaryDto,
  ListAssetsQueryDto,
  ListAssetsResponseDto,
} from './assets.dto';

const toDto = (asset: InternalAssetDto): AssetDto => ({
  id: asset.id,
  kind: asset.kind,
  name: asset.name,
  contentType: asset.contentType,
  size: asset.size,
  width: asset.width,
  height: asset.height,
  durationSeconds: asset.durationSeconds,
  sourceKey: asset.key,
  createdAt: asset.createdAt,
});

/**
 * The media library: every uploaded file a job has used, with what the jobs made of it.
 * Another user's asset is reported as missing, so ids cannot be probed.
 */
@ApiTags('assets')
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded, see Retry-After' })
@UseGuards(AuthGuard, RateLimitGuard)
@Controller('v1/assets')
export class AssetsController {
  constructor(
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly presenter: JobPresenter,
  ) {}

  @Get()
  @ApiOkResponse({ type: ListAssetsResponseDto })
  async list(
    @UserId() userId: string,
    @Query() query: ListAssetsQueryDto,
  ): Promise<ListAssetsResponseDto> {
    const page = await this.metadata.listAssets({ userId, ...query });
    return {
      items: await Promise.all(page.items.map((asset) => this.toSummary(asset))),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: AssetDetailsDto })
  @ApiNotFoundResponse()
  async get(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssetDetailsDto> {
    // The job list is filtered by user too, so it can run alongside the ownership check.
    const [asset, jobs] = await Promise.all([
      this.metadata.getAsset(id, userId),
      this.metadata.listJobs({
        userId,
        assetId: id,
        types: [...MEDIA_JOB_TYPES],
        limit: ASSET_DETAIL_JOBS,
      }),
    ]);
    return {
      ...toDto(asset),
      originalUrl: await this.presenter.presign(asset.key),
      jobs: await Promise.all(jobs.items.map((job) => this.presenter.toResponse(job))),
      jobsNextCursor: jobs.nextCursor,
    };
  }

  /** The original and every result are removed from storage shortly after. */
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Code ASSET_BUSY: a job on the file is still running' })
  async delete(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.metadata.deleteAsset(id, userId);
  }

  private async toSummary({
    preview,
    latestJob,
    ...asset
  }: InternalAssetSummaryDto): Promise<AssetSummaryDto> {
    return {
      ...toDto(asset),
      preview: preview && {
        url: await this.presenter.presign(preview.key),
        width: preview.width,
        height: preview.height,
      },
      latestJob,
    };
  }
}
