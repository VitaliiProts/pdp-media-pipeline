import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  type ApiKeyDto,
  CreateApiKeyRequest,
  type CreatedApiKeyDto,
  type ListApiKeysResponse,
  LoginRequest,
  RegisterRequest,
  ResolveApiKeyRequest,
  type UserDto,
} from '@pdp/contracts';
import { type z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AccountsService } from './accounts.service';

/** Internal API: reachable only inside the compose network / cluster, no auth. */
@Controller('internal')
export class AuthController {
  constructor(private readonly accounts: AccountsService) {}

  @Post('auth/register')
  register(@Body(new ZodValidationPipe(RegisterRequest)) body: RegisterRequest): Promise<UserDto> {
    return this.accounts.register(body);
  }

  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(LoginRequest)) body: LoginRequest): Promise<UserDto> {
    return this.accounts.login(body);
  }

  /** Gateway sends only the SHA-256 of the key; the key itself never leaves the gateway. */
  @Post('auth/resolve')
  @HttpCode(200)
  async resolve(
    @Body(new ZodValidationPipe(ResolveApiKeyRequest))
    body: z.infer<typeof ResolveApiKeyRequest>,
  ): Promise<{ userId: string }> {
    return { userId: await this.accounts.resolveApiKey(body.apiKeyHash) };
  }

  @Get('users/:id')
  getUser(@Param('id', ParseUUIDPipe) id: string): Promise<UserDto> {
    return this.accounts.getUser(id);
  }

  @Get('api-keys')
  async listApiKeys(@Query('userId', ParseUUIDPipe) userId: string): Promise<ListApiKeysResponse> {
    return { items: await this.accounts.listApiKeys(userId) };
  }

  @Post('api-keys')
  createApiKey(
    @Body(new ZodValidationPipe(CreateApiKeyRequest)) body: CreateApiKeyRequest,
  ): Promise<CreatedApiKeyDto> {
    return this.accounts.createApiKey(body);
  }

  @Delete('api-keys/:id')
  revokeApiKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<ApiKeyDto> {
    return this.accounts.revokeApiKey(id, userId);
  }
}
