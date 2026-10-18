import { classifyStatus } from '@pdp/egress';

export interface ProviderErrorOptions {
  status?: number;
  retryAfterMs?: number;
  /** Overrides what the status says, e.g. for a model that refuses the content. */
  permanent?: boolean;
}

/**
 * A failed call to an external model. `permanent` follows the worker convention: a client
 * error other than 408/409/425/429 means the same request cannot succeed. Without a status
 * (timeout, network, malformed answer) a retry may help.
 */
export class ProviderError extends Error {
  readonly permanent: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    readonly provider: string,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.permanent =
      options.permanent ??
      (options.status !== undefined && classifyStatus(options.status) === 'permanent');
  }
}

/** `Retry-After` in seconds or as an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}
