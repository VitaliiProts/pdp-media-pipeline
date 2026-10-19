import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { DUB_MAX_DURATION_SECONDS, type DubQuotaDto, type MetadataErrorBody } from '@pdp/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Db, type Tx } from '../database/postgres.service';
import { assets, jobs, users } from '../database/schema';

const error = (code: MetadataErrorBody['code'], message: string): MetadataErrorBody => ({
  code,
  message,
});

/**
 * Checks a new dub against the monthly quota inside the transaction that creates it. A dub
 * counts the duration it reported once it succeeded, and until then the known duration of its
 * asset, or the longest allowed when nothing probed it yet. A failed or dead dub counts nothing.
 */
export async function assertDubQuota(
  tx: Tx,
  userId: string,
  sourceKey: string,
  quotaSeconds: number,
): Promise<void> {
  // Serialises the check per user, so two dubs cannot both fit the last gap; NO KEY UPDATE
  // leaves inserts that only reference the user unblocked.
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for('no key update');
  if (!user) throw new NotFoundException(error('USER_NOT_FOUND', `user ${userId} not found`));

  const [asset] = await tx
    .select({ durationSeconds: assets.durationSeconds })
    .from(assets)
    .where(and(eq(assets.key, sourceKey), eq(assets.userId, userId), isNull(assets.deletedAt)));
  const known = asset?.durationSeconds ?? null;
  if (known !== null && known > DUB_MAX_DURATION_SECONDS) {
    throw new BadRequestException(
      error(
        'VALIDATION_FAILED',
        `the video is ${Math.round(known)} s long; a dub takes up to ${DUB_MAX_DURATION_SECONDS} s`,
      ),
    );
  }

  const needed = Math.ceil(known ?? DUB_MAX_DURATION_SECONDS);
  const used = await usedDubSeconds(tx, userId);
  if (used + needed > quotaSeconds) {
    throw new HttpException(
      error(
        'DUB_QUOTA_EXCEEDED',
        `dub quota exceeded: ${used} of ${quotaSeconds} s used this month, the video needs ` +
          `${needed} s`,
      ),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** What `assertDubQuota` would count now; a read without the user lock, for display. */
export async function dubQuotaOf(
  db: Db,
  userId: string,
  quotaSeconds: number,
  now = new Date(),
): Promise<DubQuotaDto> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) throw new NotFoundException(error('USER_NOT_FOUND', `user ${userId} not found`));
  return {
    usedSeconds: await usedDubSeconds(db, userId),
    limitSeconds: quotaSeconds,
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

async function usedDubSeconds(tx: Db | Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({
      used: sql<string>`coalesce(sum(case
        when ${jobs.status} = 'succeeded'
          then coalesce((${jobs.output} ->> 'durationSeconds')::float8, ${DUB_MAX_DURATION_SECONDS})
        when ${jobs.status} in ('failed', 'dead') then 0
        else coalesce(${assets.durationSeconds}, ${DUB_MAX_DURATION_SECONDS})
      end), 0)`,
    })
    .from(jobs)
    .leftJoin(assets, eq(assets.id, jobs.assetId))
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.type, 'video.dub'),
        sql`${jobs.createdAt} >= date_trunc('month', now(), 'UTC')`,
      ),
    );
  return Math.ceil(Number(row?.used ?? 0));
}
