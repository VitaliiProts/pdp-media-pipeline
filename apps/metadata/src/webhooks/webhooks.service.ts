import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateWebhookEndpointRequest,
  generateWebhookMessageId,
  generateWebhookSecret,
  type MetadataErrorBody,
  WEBHOOK_MAX_ENDPOINTS_PER_USER,
  type WebhookDeliverInputV1,
  type WebhookEndpointDto,
  type WebhookEndpointWithSecretDto,
  type WebhookEvent,
} from '@pdp/contracts';
import { and, arrayContains, asc, count, eq } from 'drizzle-orm';
import { PostgresService, type Tx } from '../database/postgres.service';
import {
  auditLog,
  type JobRow,
  users,
  type WebhookEndpointRow,
  webhookEndpoints,
} from '../database/schema';
import { insertJob } from '../jobs/insert-job';

const error = (code: MetadataErrorBody['code'], message: string): MetadataErrorBody => ({
  code,
  message,
});

const toDto = (row: WebhookEndpointRow): WebhookEndpointDto => ({
  id: row.id,
  userId: row.userId,
  url: row.url,
  events: row.events,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class WebhooksService {
  constructor(private readonly pg: PostgresService) {}

  async create(req: CreateWebhookEndpointRequest): Promise<WebhookEndpointWithSecretDto> {
    return this.pg.db.transaction(async (tx) => {
      // Serialises creations per user, so concurrent requests cannot both pass the limit.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, req.userId)).for('update');
      const [existing] = await tx
        .select({ n: count() })
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.userId, req.userId));
      if ((existing?.n ?? 0) >= WEBHOOK_MAX_ENDPOINTS_PER_USER) {
        throw new ConflictException(
          error(
            'WEBHOOK_LIMIT_REACHED',
            `at most ${WEBHOOK_MAX_ENDPOINTS_PER_USER} webhook endpoints per user`,
          ),
        );
      }

      const [row] = await tx
        .insert(webhookEndpoints)
        .values({
          userId: req.userId,
          url: req.url,
          events: req.events,
          secret: generateWebhookSecret(),
        })
        .returning();
      if (!row) throw new Error('insert returned no row');
      await tx.insert(auditLog).values({
        actor: `user:${req.userId}`,
        action: 'webhook.created',
        entityId: row.id,
        data: { url: row.url, events: row.events },
      });
      return { ...toDto(row), secret: row.secret };
    });
  }

  async list(userId: string): Promise<WebhookEndpointDto[]> {
    const rows = await this.pg.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.userId, userId))
      .orderBy(asc(webhookEndpoints.createdAt));
    return rows.map(toDto);
  }

  async getWithSecret(id: string): Promise<WebhookEndpointWithSecretDto> {
    const [row] = await this.pg.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id));
    if (!row) throw this.notFound(id);
    return { ...toDto(row), secret: row.secret };
  }

  /** Queued deliveries to a deleted endpoint fail permanently when they run. */
  async delete(id: string, userId: string): Promise<WebhookEndpointDto> {
    return this.pg.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(webhookEndpoints)
        .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)))
        .returning();
      if (!row) throw this.notFound(id);
      await tx.insert(auditLog).values({
        actor: `user:${userId}`,
        action: 'webhook.deleted',
        entityId: id,
        data: { url: row.url },
      });
      return toDto(row);
    });
  }

  /**
   * One `webhook.deliver` job per subscribed endpoint, in the transaction that finished the
   * job: the notification exists exactly when the outcome is committed.
   */
  async enqueueDeliveries(tx: Tx, job: JobRow, event: WebhookEvent): Promise<number> {
    const endpoints = await tx
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.userId, job.userId),
          arrayContains(webhookEndpoints.events, [event]),
        ),
      );

    for (const endpoint of endpoints) {
      const input: WebhookDeliverInputV1 = {
        endpointId: endpoint.id,
        messageId: generateWebhookMessageId(),
        payload: {
          type: event,
          timestamp: new Date().toISOString(),
          data: {
            jobId: job.id,
            jobType: job.type,
            status: job.status,
            attempts: job.attempts,
            deadReason: job.deadReason,
            lastError: job.lastError,
            output: job.output,
            finishedAt: job.finishedAt?.toISOString() ?? null,
          },
        },
      };
      await insertJob(tx, {
        userId: job.userId,
        type: 'webhook.deliver',
        input,
        actor: 'metadata',
      });
    }
    return endpoints.length;
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException(error('WEBHOOK_NOT_FOUND', `webhook endpoint ${id} not found`));
  }
}
