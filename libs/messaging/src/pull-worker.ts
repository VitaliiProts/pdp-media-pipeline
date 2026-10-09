import { type Consumer, type JsMsg } from '@nats-io/jetstream';
import { Logger } from '@nestjs/common';
import { type Semaphore } from './semaphore';

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
 * Pulls only as many messages as there are free slots. Taking more would leave
 * them buffered client-side while their AckWait runs out, producing redeliveries.
 */
export class PullWorker {
  private readonly logger: Logger;
  private stopped = false;
  private loop?: Promise<void>;
  private readonly inFlight = new Set<Promise<void>>();

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
      const reserved = await semaphore.reserveAll();
      let received = 0;
      try {
        if (this.stopped) break;
        const batch = await consumer.fetch({
          max_messages: reserved,
          expires: this.options.fetchExpiresMs ?? 5000,
        });
        for await (const msg of batch) {
          received++;
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
        semaphore.release(reserved - received);
      }
    }
  }

  private async process(msg: JsMsg): Promise<void> {
    const heartbeat = setInterval(() => msg.working(), this.options.heartbeatMs);
    try {
      const result = await this.options.handler(msg);
      this.settle(msg, result);
    } catch (err) {
      this.logger.error(
        `handler error on ${msg.subject} seq=${msg.seq}: ${(err as Error).message}`,
      );
      msg.nak(this.options.errorNakDelayMs ?? 2000);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private settle(msg: JsMsg, result: HandlerResult): void {
    switch (result.kind) {
      case 'ack':
        msg.ack();
        return;
      case 'nak':
        msg.nak(result.delayMs);
        return;
      case 'term':
        this.logger.warn(`term ${msg.subject} seq=${msg.seq}: ${result.reason}`);
        msg.term(result.reason);
        return;
    }
  }
}
