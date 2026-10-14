import {
  Body,
  Controller,
  HttpCode,
  PayloadTooLargeException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { uploadKeyPrefix } from '@pdp/contracts';
import { randomUUID } from 'node:crypto';
import { AuthGuard } from '../auth/auth.guard';
import { UserId } from '../auth/user';
import { type Env } from '../config';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { StorageService } from '../storage/storage.service';
import {
  CreateUploadDto,
  isVideoContentType,
  type UploadContentType,
  UploadResponseDto,
} from './uploads.dto';

export const UPLOAD_URL_TTL_S = 10 * 60;

const EXTENSIONS: Record<UploadContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

@ApiTags('uploads')
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded, see Retry-After' })
@UseGuards(AuthGuard, RateLimitGuard)
@Controller('v1/uploads')
export class UploadsController {
  private readonly maxImageBytes: number;
  private readonly maxVideoBytes: number;

  constructor(
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.maxImageBytes = config.get('MAX_UPLOAD_BYTES', { infer: true });
    this.maxVideoBytes = config.get('MAX_VIDEO_UPLOAD_BYTES', { infer: true });
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: UploadResponseDto })
  async create(
    @UserId() userId: string,
    @Body() body: CreateUploadDto,
  ): Promise<UploadResponseDto> {
    const maxBytes = isVideoContentType(body.contentType) ? this.maxVideoBytes : this.maxImageBytes;
    if (body.size > maxBytes) {
      throw new PayloadTooLargeException(`file exceeds ${maxBytes} bytes`);
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
