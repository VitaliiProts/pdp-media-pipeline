export interface ReadinessCheck {
  /** Key in the /health/ready response, e.g. `postgres`, `nats`. */
  name: string;
  /** Resolves when the dependency is usable, rejects otherwise. */
  check: () => Promise<void>;
}

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');
