import { type Consumer, type JsMsg } from '@nats-io/jetstream';
import { Logger } from '@nestjs/common';
import { type Span, SpanStatusCode } from '@opentelemetry/api';
import { processDurationHistogram } from './metrics';
import { type Semaphore } from './semaphore';
import { withConsumerSpan } from './tracing';

export type HandlerResult =
  { kind: 'ack' } | { kind: 'nak'; delayMs: number } | { kind: 'term'; reason: string };

export const ack = (): HandlerResult => ({ kind: 'ack' });
export const nak = (delayMs: number): HandlerResult => ({ kind: 'nak', delayMs });
export const term = (reason: string): HandlerResult => ({ kind: 'term', reason });

export interface PullWorkerOptions {
  name: string;
  consumer: Consumer;
  handler: (msg: JsMsg) => Promise<HandlerResult>;
  /** Shared across workers to cap total in-flight messages per process. */
  semaphore: Semaphore;
  /** Must be well below the consumer AckWait; usually AckWait / 3. */
  heartbeatMs: number;
  /** Used when the handler throws instead of returning a result. */
  errorNakDelayMs?: number;
  fetchExpiresMs?: number;
}

/**
 * Pulls a message only when a slot is free. Taking more would leave them
 * buffered client-side while their AckWait runs out, producing redeliveries.
 */
export class PullWorker {
  private readonly logger: Logger;
  private stopped = false;
  private loop?: Promise<void>;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly duration = processDurationHistogram();

  constructor(private readonly options: PullWorkerOptions) {
    this.logger = new Logger(`PullWorker:${options.name}`);
  }

  start(): void {
    this.loop = this.run();
  }

  /** Stops pulling, then waits for in-flight messages up to `timeoutMs`. */
  async stop(timeoutMs: number): Promise<void> {
    this.stopped = true;
    await this.loop;
    const drained = Promise.all(this.inFlight).then(() => true);
    const timedOut = new Promise<false>((r) => setTimeout(() => r(false), timeoutMs).unref());
    if (!(await Promise.race([drained, timedOut]))) {
      this.logger.warn(`${this.inFlight.size} message(s) still in flight after ${timeoutMs}ms`);
    }
  }

  private async run(): Promise<void> {
    const { consumer, semaphore } = this.options;
    while (!this.stopped) {
      // One slot per fetch: a consumer waiting on an empty stream holds at most one
      // slot, so consumers sharing the semaphore (cpu and priority) never starve each other.
      await semaphore.acquire();
      let handedOff = false;
      try {
        if (this.stopped) break;
        const batch = await consumer.fetch({
          max_messages: 1,
          expires: this.options.fetchExpiresMs ?? 5000,
        });
        for await (const msg of batch) {
          handedOff = true;
          const task = this.process(msg).finally(() => {
            semaphore.release();
            this.inFlight.delete(task);
          });
          this.inFlight.add(task);
        }
      } catch (err) {
        if (!this.stopped) {
          this.logger.error(`fetch failed: ${(err as Error).message}`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        if (!handedOff) semaphore.release();
      }
    }
  }

  private process(msg: JsMsg): Promise<void> {
    return withConsumerSpan(msg, this.options.name, async (span) => {
      const heartbeat = setInterval(() => msg.working(), this.options.heartbeatMs);
      const startedAt = performance.now();
      const record = (outcome: HandlerResult['kind'] | 'error') =>
        this.duration.record((performance.now() - startedAt) / 1000, {
          'messaging.system': 'nats',
          'messaging.destination.name': msg.subject,
          'messaging.consumer.group.name': this.options.name,
          'messaging.nats.outcome': outcome,
        });
      try {
        const result = await this.options.handler(msg);
        this.settle(msg, result, span);
        record(result.kind);
      } catch (err) {
        record('error');
        this.logger.error(
          `handler error on ${msg.subject} seq=${msg.seq}: ${(err as Error).message}`,
        );
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        const delayMs = this.options.errorNakDelayMs ?? 2000;
        span.setAttributes({
          'messaging.nats.outcome': 'nak',
          'messaging.nats.nak_delay_ms': delayMs,
        });
        msg.nak(delayMs);
      } finally {
        clearInterval(heartbeat);
      }
    });
  }

  private settle(msg: JsMsg, result: HandlerResult, span: Span): void {
    span.setAttribute('messaging.nats.outcome', result.kind);
    switch (result.kind) {
      case 'ack':
        msg.ack();
        return;
      case 'nak':
        span.setAttribute('messaging.nats.nak_delay_ms', result.delayMs);
        msg.nak(result.delayMs);
        return;
      case 'term':
        this.logger.warn(`term ${msg.subject} seq=${msg.seq}: ${result.reason}`);
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.reason });
        msg.term(result.reason);
        return;
    }
  }
}
