import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { API_KEY_MAX_PER_USER } from '@pdp/contracts';
import { MetadataClient } from '@pdp/metadata-client';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { CreateApiKeyDto, CreatedApiKeyResponseDto, ListApiKeysResponseDto } from './auth.dto';
import { AuthGuard } from './auth.guard';
import { type AuthenticatedRequest, UserId } from './user';

/**
 * Keys are created and revoked from a logged-in session only: a leaked key must not be able
 * to mint keys that outlive its own revocation (ADR-013). Revocation reaches every gateway
 * within `API_KEY_CACHE_TTL_MS`.
 */
@ApiTags('api-keys')
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded, see Retry-After' })
@UseGuards(AuthGuard, RateLimitGuard)
@Controller('v1/api-keys')
export class ApiKeysController {
  constructor(@Inject(MetadataClient) private readonly metadata: MetadataClient) {}

  @Get()
  @ApiOkResponse({ type: ListApiKeysResponseDto })
  list(@UserId() userId: string): Promise<ListApiKeysResponseDto> {
    return this.metadata.listApiKeys(userId);
  }

  @Post()
  @ApiCreatedResponse({ type: CreatedApiKeyResponseDto })
  @ApiForbiddenResponse({ description: 'Requires a session, not an API key' })
  @ApiConflictResponse({ description: `At most ${API_KEY_MAX_PER_USER} active keys per user` })
  create(
    @Req() req: AuthenticatedRequest,
    @UserId() userId: string,
    @Body() body: CreateApiKeyDto,
  ): Promise<CreatedApiKeyResponseDto> {
    requireSession(req);
    return this.metadata.createApiKey({ userId, name: body.name });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: 'Requires a session, not an API key' })
  async revoke(
    @Req() req: AuthenticatedRequest,
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    requireSession(req);
    await this.metadata.revokeApiKey(id, userId);
  }
}

function requireSession(req: AuthenticatedRequest): void {
  if (req.authMethod !== 'session') {
    throw new ForbiddenException('api keys are managed from a logged-in session');
  }
}
