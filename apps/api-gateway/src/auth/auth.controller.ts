import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { MetadataClient, MetadataError } from '@pdp/metadata-client';
import { authMetrics } from '@pdp/observability';
import { type Request, type Response } from 'express';
import { RetryLaterException } from '../common/retry-later';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';
import { LoginDto, MeResponseDto, RegisterDto, UserResponseDto } from './auth.dto';
import { AuthGuard } from './auth.guard';
import { SessionCookie } from './session-cookie';
import { SessionService } from './session.service';
import { type AuthenticatedRequest, UserId } from './user';

const clientIp = (req: Request): string => req.ip ?? 'unknown';

@ApiTags('auth')
@ApiForbiddenResponse({ description: 'Origin is not one of the Web UI origins' })
@Controller('v1')
export class AuthController {
  constructor(
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly sessions: SessionService,
    private readonly cookie: SessionCookie,
    private readonly limiter: RateLimiterService,
  ) {}

  /** Logs the new user in: the response sets the session cookie. */
  @Post('auth/register')
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiConflictResponse({ description: 'Email is already registered (code EMAIL_TAKEN)' })
  @ApiTooManyRequestsResponse({ description: 'Too many attempts from this IP, see Retry-After' })
  async register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: RegisterDto,
  ): Promise<UserResponseDto> {
    this.cookie.checkOrigin(req, false);
    const check = await this.limiter.checkAuth(clientIp(req));
    if (!check.allowed) {
      authMetrics.registration('rate_limited');
      throw this.tooMany(check.retryAfterS);
    }

    let user: UserResponseDto;
    try {
      user = await this.metadata.register(body);
    } catch (err) {
      if (err instanceof MetadataError && err.code === 'EMAIL_TAKEN') {
        authMetrics.registration('email_taken');
      }
      throw err;
    }
    authMetrics.registration('success');
    await this.startSession(req, res, user.id);
    return user;
  }

  @Post('auth/login')
  @HttpCode(200)
  @ApiOkResponse({ type: UserResponseDto, description: 'Sets the session cookie' })
  @ApiUnauthorizedResponse({ description: 'Unknown email or wrong password, not told apart' })
  @ApiTooManyRequestsResponse({ description: 'Too many attempts for this IP or email' })
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: LoginDto,
  ): Promise<UserResponseDto> {
    this.cookie.checkOrigin(req, false);
    const check = await this.limiter.checkAuth(clientIp(req), body.email);
    if (!check.allowed) {
      authMetrics.login('rate_limited');
      throw this.tooMany(check.retryAfterS);
    }

    const user = await this.metadata.login(body);
    if (!user) {
      authMetrics.login('invalid_credentials');
      throw new UnauthorizedException('invalid email or password');
    }
    authMetrics.login('success');
    await this.startSession(req, res, user.id);
    return user;
  }

  /** Idempotent: without a session it only clears the cookie. */
  @Post('auth/logout')
  @HttpCode(204)
  @ApiNoContentResponse()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = this.cookie.read(req);
    if (token) {
      this.cookie.checkOrigin(req, true);
      await this.sessions.destroy(token);
    }
    this.cookie.clear(res);
  }

  @Get('me')
  @UseGuards(AuthGuard, RateLimitGuard)
  @ApiOkResponse({ type: MeResponseDto })
  async me(@Req() req: AuthenticatedRequest, @UserId() userId: string): Promise<MeResponseDto> {
    const user = await this.metadata.getUser(userId);
    return { ...user, authMethod: req.authMethod ?? 'api-key' };
  }

  /** A session from before the login is dropped rather than left to expire. */
  private async startSession(req: Request, res: Response, userId: string): Promise<void> {
    const previous = this.cookie.read(req);
    if (previous) await this.sessions.destroy(previous);
    this.cookie.set(res, await this.sessions.create(userId));
  }

  private tooMany(retryAfterS: number): RetryLaterException {
    return new RetryLaterException(
      HttpStatus.TOO_MANY_REQUESTS,
      'too many attempts, try again later',
      retryAfterS,
    );
  }
}
