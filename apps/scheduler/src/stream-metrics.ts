import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { NatsService, observeStreams } from '@pdp/messaging';

/**
 * Depth of every stream and consumer backlog. The scheduler reports them because it is
 * the one service that sees all the job streams; dashboards take `max` across replicas.
 */
@Injectable()
export class StreamMetrics implements OnModuleInit, OnModuleDestroy {
  private stop?: () => void;

  constructor(private readonly nats: NatsService) {}

  onModuleInit(): void {
    this.stop = observeStreams(() => this.nats.manager());
  }

  /** Before NATS closes, so the last export at shutdown does not query a closed connection. */
  onModuleDestroy(): void {
    this.stop?.();
  }
}
