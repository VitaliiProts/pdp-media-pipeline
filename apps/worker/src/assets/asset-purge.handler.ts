import { Logger } from '@nestjs/common';
import { AssetDeletedV1, jobResultsPrefix } from '@pdp/contracts';
import { ack, type HandlerResult, nak, term } from '@pdp/messaging';

export const PURGE_RETRY_DELAY_MS = 5000;
const JOBS_PAGE = 100;

export interface AssetPurgeDeps {
  /** Jobs of the asset, deleted ones included; pages until `nextCursor` is null. */
  listJobIds: (
    userId: string,
    assetId: string,
    limit: number,
    cursor?: string,
  ) => Promise<{ ids: string[]; nextCursor: string | null }>;
  deleteObject: (key: string) => Promise<void>;
  deletePrefix: (prefix: string) => Promise<number>;
}

/**
 * Removes the original and everything under each job's results prefix, failed attempts'
 * leftovers included. Every step is idempotent, so a redelivery simply starts over.
 */
export class AssetPurgeHandler {
  private readonly logger = new Logger(AssetPurgeHandler.name);

  constructor(private readonly deps: AssetPurgeDeps) {}

  async handle(data: Uint8Array): Promise<HandlerResult> {
    let event: AssetDeletedV1;
    try {
      event = AssetDeletedV1.parse(JSON.parse(new TextDecoder().decode(data)));
    } catch (err) {
      return term(`invalid asset.deleted: ${(err as Error).message}`);
    }

    const { assetId, userId, key, reason } = event.payload;
    try {
      let objects = 0;
      let cursor: string | undefined;
      do {
        const page = await this.deps.listJobIds(userId, assetId, JOBS_PAGE, cursor);
        for (const jobId of page.ids)
          objects += await this.deps.deletePrefix(jobResultsPrefix(jobId));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      await this.deps.deleteObject(key);
      this.logger.log(`purged asset ${assetId} (${reason}): original and ${objects} results`);
      return ack();
    } catch (err) {
      this.logger.warn(`purge of asset ${assetId} failed: ${(err as Error).message}`);
      return nak(PURGE_RETRY_DELAY_MS);
    }
  }
}
