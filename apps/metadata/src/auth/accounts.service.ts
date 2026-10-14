import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  API_KEY_MAX_PER_USER,
  type ApiKeyDto,
  apiKeyPrefix,
  type CreateApiKeyRequest,
  type CreatedApiKeyDto,
  generateApiKey,
  hashApiKey,
  type LoginRequest,
  type MetadataErrorBody,
  type RegisterRequest,
  type UserDto,
} from '@pdp/contracts';
import { and, asc, count, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { PostgresService } from '../database/postgres.service';
import { apiKeys, type ApiKeyRow, auditLog, users, type UserRow } from '../database/schema';
import { hashPassword, verifyPassword } from './passwords';

const error = (code: MetadataErrorBody['code'], message: string): MetadataErrorBody => ({
  code,
  message,
});

const toUserDto = (row: UserRow): UserDto => ({
  id: row.id,
  name: row.name,
  email: row.email,
  createdAt: row.createdAt.toISOString(),
});

const toApiKeyDto = (row: ApiKeyRow): ApiKeyDto => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

@Injectable()
export class AccountsService {
  constructor(private readonly pg: PostgresService) {}

  async register(req: RegisterRequest): Promise<UserDto> {
    // Hashing takes tens of milliseconds of CPU; it stays outside the transaction.
    const passwordHash = await hashPassword(req.password);
    return this.pg.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          name: req.name ?? req.email.split('@')[0] ?? req.email,
          email: req.email,
          passwordHash,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictException(error('EMAIL_TAKEN', 'email is already registered'));
      await tx.insert(auditLog).values({
        actor: `user:${row.id}`,
        action: 'user.registered',
        entityId: row.id,
        data: { email: row.email },
      });
      return toUserDto(row);
    });
  }

  /** Unknown email and wrong password give the same error after the same amount of work. */
  async login(req: LoginRequest): Promise<UserDto> {
    const [row] = await this.pg.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, req.email));
    const valid = await verifyPassword(row?.passwordHash ?? null, req.password);
    if (!row || !valid) {
      throw new UnauthorizedException(error('INVALID_CREDENTIALS', 'invalid email or password'));
    }
    return toUserDto(row);
  }

  async getUser(id: string): Promise<UserDto> {
    const [row] = await this.pg.db.select().from(users).where(eq(users.id, id));
    if (!row) throw new NotFoundException(error('USER_NOT_FOUND', `user ${id} not found`));
    return toUserDto(row);
  }

  async resolveApiKey(hash: string): Promise<string> {
    const [key] = await this.pg.db
      .select({ id: apiKeys.id, userId: apiKeys.userId })
      .from(apiKeys)
      .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt)));
    if (!key) throw new NotFoundException(error('API_KEY_NOT_FOUND', 'unknown api key'));
    await this.pg.db
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(apiKeys.id, key.id),
          or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, sql`now() - interval '1 minute'`)),
        ),
      );
    return key.userId;
  }

  async listApiKeys(userId: string): Promise<ApiKeyDto[]> {
    const rows = await this.pg.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .orderBy(asc(apiKeys.createdAt));
    return rows.map(toApiKeyDto);
  }

  async createApiKey(req: CreateApiKeyRequest): Promise<CreatedApiKeyDto> {
    const key = generateApiKey();
    return this.pg.db.transaction(async (tx) => {
      // Serialises creations per user, so concurrent requests cannot both pass the limit.
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, req.userId))
        .for('update');
      if (!user)
        throw new NotFoundException(error('USER_NOT_FOUND', `user ${req.userId} not found`));
      const [active] = await tx
        .select({ n: count() })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, req.userId), isNull(apiKeys.revokedAt)));
      if ((active?.n ?? 0) >= API_KEY_MAX_PER_USER) {
        throw new ConflictException(
          error(
            'API_KEY_LIMIT_REACHED',
            `at most ${API_KEY_MAX_PER_USER} active api keys per user`,
          ),
        );
      }

      const [row] = await tx
        .insert(apiKeys)
        .values({
          userId: req.userId,
          name: req.name,
          hash: hashApiKey(key),
          prefix: apiKeyPrefix(key),
        })
        .returning();
      if (!row) throw new Error('insert returned no row');
      await tx.insert(auditLog).values({
        actor: `user:${req.userId}`,
        action: 'api_key.created',
        entityId: row.id,
        data: { name: row.name, prefix: row.prefix },
      });
      return { ...toApiKeyDto(row), key };
    });
  }

  /** Idempotent: revoking a revoked key returns it again. */
  async revokeApiKey(id: string, userId: string): Promise<ApiKeyDto> {
    return this.pg.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(apiKeys)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
        .returning();
      if (revoked) {
        await tx.insert(auditLog).values({
          actor: `user:${userId}`,
          action: 'api_key.revoked',
          entityId: id,
          data: { prefix: revoked.prefix },
        });
        return toApiKeyDto(revoked);
      }
      const [existing] = await tx
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
      if (!existing)
        throw new NotFoundException(error('API_KEY_NOT_FOUND', `api key ${id} not found`));
      return toApiKeyDto(existing);
    });
  }
}
