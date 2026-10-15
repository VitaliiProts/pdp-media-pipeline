import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type AssetDto,
  CreateAssetRequest,
  ListAssetsQuery,
  type ListAssetsResponse,
} from '@pdp/contracts';
import { type z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AssetsService } from './assets.service';

/** Internal API: reachable only inside the compose network / cluster, no auth. */
@Controller('internal/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateAssetRequest)) body: CreateAssetRequest,
  ): Promise<AssetDto> {
    return this.assets.create(body);
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(ListAssetsQuery)) query: z.output<typeof ListAssetsQuery>,
  ): Promise<ListAssetsResponse> {
    return this.assets.list(query);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<AssetDto> {
    return this.assets.get(id, userId);
  }

  @Delete(':id')
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<AssetDto> {
    return this.assets.delete(id, userId);
  }
}
