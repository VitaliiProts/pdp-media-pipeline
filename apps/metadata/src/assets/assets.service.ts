import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssetDeletedV1,
  type AssetDto,
  assetKindOf,
  type AssetStatus,
  type AssetSummaryDto,
  type CreateAssetRequest,
  type DubTargetLanguage,
  DubTargetLanguageSchema,
  type JobStatus,
  type ListAssetsQuery,
  type ListAssetsResponse,
  type MetadataErrorBody,
  PREVIEW_JOB_TYPES,
  previewOf,
  sourceFactsOf,
} from '@pdp/contracts';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { type Env } from '../config';
import { PostgresService, type Tx } from '../database/postgres.service';
import { assets, type AssetRow, auditLog, type JobRow, jobs, users } from '../database/schema';
import { decodeCursor, encodeCursor } from '../jobs/job.mapper';
import { enqueueEvent } from '../outbox/outbox';

const error = (code: MetadataErrorBody['code'], message: string): MetadataErrorBody => ({
  code,
  message,
});

const ACTIVE_STATUSES = ['queued', 'scheduled', 'running'] as const;
export const JANITOR_BATCH = 100;

const JOB_STATUSES_OF: Record<AssetStatus, JobStatus[]> = {
  processing: [...ACTIVE_STATUSES],
  ready: ['succeeded'],
  failed: ['failed', 'dead'],
};

/** `%`, `_` and `\` match themselves; `\` is Postgres' default LIKE escape. */
function containing(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export const toAssetDto = (row: AssetRow): AssetDto => ({
  id: row.id,
  userId: row.userId,
  key: row.key,
  kind: row.kind,
  name: row.name,
  contentType: row.contentType,
  size: row.size,
  width: row.width,
  height: row.height,
  durationSeconds: row.durationSeconds,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Assets are created when an upload is signed, attached by their first job and soft-deleted
 * together with an `asset.deleted` event. The row lock orders the three: a job never lands on
 * a deleted asset, and an asset with a job in flight is never deleted.
 */
@Injectable()
export class AssetsService {
  private readonly quotaBytes: number;
  private readonly unusedTtlS: number;

  constructor(
    private readonly pg: PostgresService,
    config: ConfigService<Env, true>,
  ) {
    this.quotaBytes = config.get('STORAGE_QUOTA_BYTES', { infer: true });
    this.unusedTtlS = config.get('ASSET_UNUSED_TTL_S', { infer: true });
  }

  /** Reserves the declared size against the quota before the client uploads anything. */
  async create(req: CreateAssetRequest): Promise<AssetDto> {
    return this.pg.db.transaction(async (tx) => {
      // Serialises reservations per user, so concurrent uploads cannot both fit the last gap.
      // NO KEY UPDATE leaves inserts that only reference the user (jobs, keys) unblocked.
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, req.userId))
        .for('no key update');
      if (!user)
        throw new NotFoundException(error('USER_NOT_FOUND', `user ${req.userId} not found`));

      const used = await this.usedBytes(tx, req.userId);
      if (used + req.size > this.quotaBytes) {
        throw new PayloadTooLargeException(
          error(
            'STORAGE_QUOTA_EXCEEDED',
            `storage quota exceeded: ${used} of ${this.quotaBytes} bytes used, the file needs ` +
              `${req.size}; delete files from the library to free space`,
          ),
        );
      }

      const [row] = await tx
        .insert(assets)
        .values({
          userId: req.userId,
          key: req.key,
          kind: assetKindOf(req.contentType),
          name: req.name ?? null,
          contentType: req.contentType,
          size: req.size,
        })
        .returning();
      if (!row) throw new Error('insert returned no row');
      return toAssetDto(row);
    });
  }

  private async usedBytes(tx: Tx, userId: string): Promise<number> {
    const [row] = await tx
      .select({ used: sql<string>`coalesce(sum(${assets.size}), 0)` })
      .from(assets)
      .where(and(eq(assets.userId, userId), isNull(assets.deletedAt)));
    return Number(row?.used ?? 0);
  }

  /** Assets with at least one job, newest first; bare uploads are not part of the library. */
  async list(query: ListAssetsQuery & { limit: number }): Promise<ListAssetsResponse> {
    const filters: SQL[] = [
      eq(assets.userId, query.userId),
      isNull(assets.deletedAt),
      isNotNull(assets.attachedAt),
    ];
    if (query.kind) filters.push(eq(assets.kind, query.kind));
    if (query.status) {
      const latestJobStatus = sql`(
        SELECT ${jobs.status} FROM ${jobs}
        WHERE ${jobs.assetId} = ${assets.id}
        ORDER BY ${jobs.createdAt} DESC, ${jobs.id} DESC
        LIMIT 1
      )`;
      filters.push(inArray(latestJobStatus, JOB_STATUSES_OF[query.status]));
    }
    if (query.q) filters.push(ilike(assets.name, containing(query.q)));
    if (query.dubbed) {
      filters.push(sql`EXISTS (
        SELECT 1 FROM ${jobs}
        WHERE ${jobs.assetId} = ${assets.id}
          AND ${jobs.type} = 'video.dub' AND ${jobs.status} = 'succeeded'
      )`);
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (!cursor) throw new BadRequestException(error('VALIDATION_FAILED', 'invalid cursor'));
      filters.push(sql`(${assets.createdAt}, ${assets.id}) < (${cursor.createdAt}, ${cursor.id})`);
    }

    const rows = await this.pg.db
      .select()
      .from(assets)
      .where(and(...filters))
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await this.summaries(page),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * Three queries for the whole page: the latest and the latest preview-producing job per asset
   * off `jobs_asset_created_idx`, and the languages of its dubs.
   */
  private async summaries(page: AssetRow[]): Promise<AssetSummaryDto[]> {
    if (page.length === 0) return [];
    const ids = page.map((a) => a.id);
    const [latest, succeeded, dubbed] = await Promise.all([
      this.pg.db
        .selectDistinctOn([jobs.assetId], {
          assetId: jobs.assetId,
          id: jobs.id,
          type: jobs.type,
          status: jobs.status,
          progress: jobs.progress,
        })
        .from(jobs)
        .where(inArray(jobs.assetId, ids))
        .orderBy(jobs.assetId, desc(jobs.createdAt), desc(jobs.id)),
      this.pg.db
        .selectDistinctOn([jobs.assetId], {
          assetId: jobs.assetId,
          type: jobs.type,
          output: jobs.output,
        })
        .from(jobs)
        .where(
          and(
            inArray(jobs.assetId, ids),
            eq(jobs.status, 'succeeded'),
            inArray(jobs.type, [...PREVIEW_JOB_TYPES]),
          ),
        )
        .orderBy(jobs.assetId, desc(jobs.createdAt), desc(jobs.id)),
      this.pg.db
        .selectDistinct({
          assetId: jobs.assetId,
          language: sql<string>`${jobs.input} ->> 'targetLanguage'`,
        })
        .from(jobs)
        .where(
          and(inArray(jobs.assetId, ids), eq(jobs.type, 'video.dub'), eq(jobs.status, 'succeeded')),
        ),
    ]);
    const dubsBy = new Map<string, DubTargetLanguage[]>();
    for (const { assetId, language } of dubbed) {
      const parsed = DubTargetLanguageSchema.safeParse(language);
      if (!assetId || !parsed.success) continue;
      dubsBy.set(assetId, [...(dubsBy.get(assetId) ?? []), parsed.data].sort());
    }
    // The last value of an earlier attempt would be stale once the job left `running`.
    const latestBy = new Map(
      latest.map(({ assetId, progress, ...job }) => [
        assetId,
        { ...job, progress: job.status === 'running' ? progress : null },
      ]),
    );
    const previewBy = new Map(succeeded.map((j) => [j.assetId, previewOf(j.type, j.output)]));
    return page.map((row) => ({
      ...toAssetDto(row),
      preview: previewBy.get(row.id) ?? null,
      latestJob: latestBy.get(row.id) ?? null,
      dubs: dubsBy.get(row.id) ?? [],
    }));
  }

  /** Another user's asset and a deleted one are reported as missing alike. */
  async get(id: string, userId: string): Promise<AssetDto> {
    const [row] = await this.pg.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.userId, userId), isNull(assets.deletedAt)));
    if (!row) throw this.notFound(id);
    return toAssetDto(row);
  }

  /**
   * Refused while a job is queued or running: its results would land after the purge.
   * The objects go asynchronously, through the event the purge consumer reads.
   */
  async delete(id: string, userId: string): Promise<AssetDto> {
    return this.pg.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(assets)
        .where(and(eq(assets.id, id), eq(assets.userId, userId), isNull(assets.deletedAt)))
        .for('update');
      if (!row) throw this.notFound(id);

      const [active] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.assetId, id), inArray(jobs.status, ACTIVE_STATUSES)))
        .limit(1);
      if (active) {
        throw new ConflictException(
          error('ASSET_BUSY', `asset ${id} has jobs in progress; delete it once they finish`),
        );
      }

      const deleted = await this.softDelete(tx, row, 'user', `user:${userId}`);
      return toAssetDto(deleted);
    });
  }

  /**
   * Deletes uploads that no job used within the TTL: abandoned dialogs and failed job
   * creation. `SKIP LOCKED` passes over an asset a job is being attached to right now.
   *
   * @returns how many were deleted
   */
  async purgeUnused(): Promise<number> {
    return this.pg.db.transaction(async (tx) => {
      const stale = await tx
        .select()
        .from(assets)
        .where(
          and(
            isNull(assets.attachedAt),
            isNull(assets.deletedAt),
            sql`${assets.createdAt} < now() - make_interval(secs => ${this.unusedTtlS})`,
          ),
        )
        .orderBy(assets.createdAt)
        .limit(JANITOR_BATCH)
        .for('update', { skipLocked: true });
      for (const row of stale) await this.softDelete(tx, row, 'unused', 'metadata');
      return stale.length;
    });
  }

  private async softDelete(
    tx: Tx,
    row: AssetRow,
    reason: AssetDeletedV1['payload']['reason'],
    actor: string,
  ): Promise<AssetRow> {
    const [deleted] = await tx
      .update(assets)
      .set({ deletedAt: new Date() })
      .where(eq(assets.id, row.id))
      .returning();
    if (!deleted) throw new Error('update returned no row');
    await enqueueEvent(tx, AssetDeletedV1, {
      assetId: row.id,
      userId: row.userId,
      key: row.key,
      reason,
    });
    await tx.insert(auditLog).values({
      actor,
      action: 'asset.deleted',
      entityId: row.id,
      data: { key: row.key, reason },
    });
    return deleted;
  }

  /**
   * The asset a new job reads, attached on first use. The conditional update locks only a
   * not-yet-attached row; every later job takes a share lock, so jobs on one asset do not
   * queue behind each other, while delete and the janitor still wait for them.
   */
  async attachForJob(tx: Tx, userId: string, key: string): Promise<string> {
    const mine = and(eq(assets.key, key), eq(assets.userId, userId));
    const [attached] = await tx
      .update(assets)
      .set({ attachedAt: new Date() })
      .where(and(mine, isNull(assets.attachedAt), isNull(assets.deletedAt)))
      .returning({ id: assets.id });
    if (attached) return attached.id;

    const [row] = await tx
      .select({ id: assets.id, deletedAt: assets.deletedAt })
      .from(assets)
      .where(mine)
      .for('share');
    if (!row) {
      throw new BadRequestException(
        error('ASSET_NOT_FOUND', 'sourceKey is not an upload of this user; use POST /v1/uploads'),
      );
    }
    if (row.deletedAt) {
      throw new BadRequestException(error('ASSET_NOT_FOUND', 'the file at sourceKey was deleted'));
    }
    return row.id;
  }

  /** Share-locked, so a delete cannot commit between this check and the caller's write. */
  async isDeleted(tx: Tx, id: string): Promise<boolean> {
    const [row] = await tx
      .select({ deletedAt: assets.deletedAt })
      .from(assets)
      .where(eq(assets.id, id))
      .for('share');
    return row?.deletedAt != null;
  }

  /** Records what a succeeded job learned about the original, once. */
  async recordSourceFacts(tx: Tx, job: JobRow): Promise<void> {
    if (!job.assetId) return;
    const facts = sourceFactsOf(job.type, job.output);
    if (!facts) return;
    await tx
      .update(assets)
      .set(facts)
      .where(and(eq(assets.id, job.assetId), isNull(assets.width)));
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException(error('ASSET_NOT_FOUND', `asset ${id} not found`));
  }
}
