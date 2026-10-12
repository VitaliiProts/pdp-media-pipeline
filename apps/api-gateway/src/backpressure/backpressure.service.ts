import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type JobClass } from '@pdp/contracts';
import { RetryLaterException } from '../common/retry-later';
import { type Env } from '../config';
import { QueueDepthService } from './queue-depth.service';

/**
 * Load shedding for new jobs: refusing early keeps latency flat, while accepting
 * into an overfull queue only moves the wait into the queue. Only the class the
 * job would go to counts, so a CPU backlog does not block priority work.
 */
@Injectable()
export class BackpressureService {
  private readonly maxDepth: Record<JobClass, number>;
  private readonly retryAfterS: number;

  constructor(
    private readonly depths: QueueDepthService,
    config: ConfigService<Env, true>,
  ) {
    this.maxDepth = {
      cpu: config.get('BACKPRESSURE_MAX_DEPTH_CPU', { infer: true }),
      io: config.get('BACKPRESSURE_MAX_DEPTH_IO', { infer: true }),
      priority: config.get('BACKPRESSURE_MAX_DEPTH_PRIORITY', { infer: true }),
    };
    this.retryAfterS = config.get('BACKPRESSURE_RETRY_AFTER_S', { infer: true });
  }

  /** Unknown depth admits the job: the outbox holds it until the queue is reachable. */
  async assertAccepting(jobClass: JobClass): Promise<void> {
    const depth = await this.depths.depthOf(jobClass);
    if (depth === null || depth < this.maxDepth[jobClass]) return;
    throw new RetryLaterException(
      HttpStatus.SERVICE_UNAVAILABLE,
      `the ${jobClass} queue is full, retry later`,
      this.retryAfterS,
    );
  }
}
