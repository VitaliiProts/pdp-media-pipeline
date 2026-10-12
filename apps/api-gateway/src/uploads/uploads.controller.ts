import {
  Body,
  Controller,
  HttpCode,
  PayloadTooLargeException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { API_KEY_HEADER, uploadKeyPrefix } from '@pdp/contracts';
import { randomUUID } from 'node:crypto';
import { ApiKeyGuard, UserId } from '../auth/api-key.guard';
import { type Env } from '../config';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { StorageService } from '../storage/storage.service';
import { CreateUploadDto, type UploadContentType, UploadResponseDto } from './uploads.dto';

export const UPLOAD_URL_TTL_S = 10 * 60;

const EXTENSIONS: Record<UploadContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@ApiTags('uploads')
@ApiHeader({ name: API_KEY_HEADER, required: true })
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded, see Retry-After' })
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('v1/uploads')
export class UploadsController {
  private readonly maxBytes: number;

  constructor(
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.get('MAX_UPLOAD_BYTES', { infer: true });
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: UploadResponseDto })
  async create(
    @UserId() userId: string,
    @Body() body: CreateUploadDto,
  ): Promise<UploadResponseDto> {
    if (body.size > this.maxBytes) {
      throw new PayloadTooLargeException(`file exceeds ${this.maxBytes} bytes`);
    }
    const sourceKey = `${uploadKeyPrefix(userId)}${randomUUID()}.${EXTENSIONS[body.contentType]}`;
    const uploadUrl = await this.storage.presignPut(
      sourceKey,
      body.contentType,
      body.size,
      UPLOAD_URL_TTL_S,
    );
    return {
      uploadUrl,
      sourceKey,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_S * 1000).toISOString(),
    };
  }
}
