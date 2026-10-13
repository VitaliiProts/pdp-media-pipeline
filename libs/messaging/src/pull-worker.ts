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

/** The abort reason a handler sees when the worker gives up waiting for it on shutdown. */
export class WorkerShutdownError extends Error {
  constructor() {
    super('worker is shutting down');
    this.name = 'WorkerShutdownError';
  }
}

export interface PullWorkerOptions {
  name: string;
  consumer: Consumer;
  /** `signal` aborts once `stop` stops waiting; the handler should then hand the work back. */
  handler: (msg: JsMsg, signal: AbortSignal) => Promise<HandlerResult>;
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
  private readonly stopping = new AbortController();
  private loop?: Promise<void>;
  /** Each message's own abort, so a slow one can be cancelled without touching the rest. */
  private readonly inFlight = new Map<Promise<void>, AbortController>();
  private readonly duration = processDurationHistogram();

  constructor(private readonly options: PullWorkerOptions) {
    this.logger = new Logger(`PullWorker:${options.name}`);
  }

  start(): void {
    this.loop = this.run();
  }

  /**
   * Stops pulling and lets in-flight messages finish for up to `graceMs`. Then aborts
   * them: a handler that honours the signal hands its job back, and another pod takes it
   * at once. Whatever still runs `abortGraceMs` later is left to redelivery after AckWait.
   */
  async stop(graceMs: number, abortGraceMs = 5000): Promise<void> {
    this.stopping.abort();
    const settled = () =>
      Promise.all([this.loop, ...this.inFlight.keys()]).then(
        () => true,
        () => true,
      );
    if (await within(settled(), graceMs)) return;

    this.logger.warn(`${this.inFlight.size} message(s) still running after ${graceMs}ms, aborting`);
    for (const controller of this.inFlight.values()) controller.abort(new WorkerShutdownError());
    if (await within(settled(), abortGraceMs)) return;
    this.logger.error(
      `${this.inFlight.size} message(s) ignored the abort; JetStream redelivers them after AckWait`,
    );
  }

  private async run(): Promise<void> {
    const { consumer, semaphore } = this.options;
    const stopping = this.stopping.signal;
    while (!stopping.aborted) {
      // One slot per fetch: a consumer waiting on an empty stream holds at most one
      // slot, so consumers sharing the semaphore (cpu and priority) never starve each other.
      // The wait ends on stop, or a busy process would only stop pulling after a job ends.
      try {
        await semaphore.acquire(stopping);
      } catch {
        break;
      }
      let handedOff = false;
      try {
        const batch = await consumer.fetch({
          max_messages: 1,
          expires: this.options.fetchExpiresMs ?? 5000,
        });
        for await (const msg of batch) {
          if (stopping.aborted) {
            // Pulled while stopping: back to the stream for another pod, not to AckWait.
            msg.nak();
            continue;
          }
          handedOff = true;
          const controller = new AbortController();
          const task = this.process(msg, controller.signal).finally(() => {
            semaphore.release();
            this.inFlight.delete(task);
          });
          this.inFlight.set(task, controller);
        }
      } catch (err) {
        if (!stopping.aborted) {
          this.logger.error(`fetch failed: ${(err as Error).message}`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        if (!handedOff) semaphore.release();
      }
    }
  }

  private process(msg: JsMsg, signal: AbortSignal): Promise<void> {
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
        const result = await this.options.handler(msg, signal);
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

/** Whether `done` settled within `ms`. */
function within(done: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void done.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}
