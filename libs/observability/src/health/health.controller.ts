import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { READINESS_CHECKS, type ReadinessCheck } from './readiness-check';

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    @Inject(READINESS_CHECKS) private readonly checks: ReadinessCheck[],
  ) {}

  /** Process is alive. Must not depend on external systems, otherwise an outage restarts every pod. */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /** Process can serve traffic: all dependencies respond. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check(
      this.checks.map(({ name, check }) => async () => {
        const session = this.indicator.check(name);
        try {
          await withTimeout(check(), CHECK_TIMEOUT_MS);
          return session.up();
        } catch (err) {
          return session.down({ message: err instanceof Error ? err.message : String(err) });
        }
      }),
    );
  }
}
