import { Body, Controller, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { type MetadataErrorBody, ResolveApiKeyRequest } from '@pdp/contracts';
import { eq } from 'drizzle-orm';
import { type z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PostgresService } from '../database/postgres.service';
import { users } from '../database/schema';

@Controller('internal/auth')
export class AuthController {
  constructor(private readonly pg: PostgresService) {}

  /** Gateway sends only the SHA-256 of the key; the key itself never leaves the gateway. */
  @Post('resolve')
  @HttpCode(200)
  async resolve(
    @Body(new ZodValidationPipe(ResolveApiKeyRequest))
    body: z.infer<typeof ResolveApiKeyRequest>,
  ): Promise<{ userId: string }> {
    const [user] = await this.pg.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.apiKeyHash, body.apiKeyHash));
    if (!user) {
      const error: MetadataErrorBody = { code: 'API_KEY_NOT_FOUND', message: 'unknown api key' };
      throw new NotFoundException(error);
    }
    return { userId: user.id };
  }
}
