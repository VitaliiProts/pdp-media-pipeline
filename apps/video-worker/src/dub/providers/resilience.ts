import { PermanentError } from '@pdp/worker-kit';
import { setTimeout as delay } from 'node:timers/promises';
import { ProviderError } from './provider-error';
import {
  type RefitRequest,
  type SpeechToText,
  type TokenUsage,
  type Transcript,
  type Translation,
  type TranslationRequest,
  type Translator,
} from './types';

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
  now?: () => number;
  onStateChange?: (state: BreakerState) => void;
}

/** Fails fast while open; a transient error, so the job comes back once the breaker closes. */
export class BreakerOpenError extends Error {
  constructor(
    provider: string,
    readonly retryAfterMs: number,
  ) {
    super(`${provider} circuit open`);
    this.name = 'BreakerOpenError';
  }
}

/**
 * Per provider and process (ADR-016): `failureThreshold` transient failures in a row open it for
 * `openMs`; then one call goes through as a probe, and its outcome closes or reopens it. During
 * an outage pods stop paying for requests that are sure to fail.
 */
export class CircuitBreaker {
  private current: BreakerState = 'closed';
  private failures = 0;
  private openUntil = 0;
  private probing = false;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    private readonly options: CircuitBreakerOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  get state(): BreakerState {
    return this.current;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.admit();
    try {
      const result = await fn();
      this.record(true);
      return result;
    } catch (err) {
      // A cancelled job or a bug of ours says nothing about the provider.
      if (err instanceof ProviderError) this.record(err.permanent);
      throw err;
    } finally {
      this.probing = false;
    }
  }

  private admit(): void {
    if (this.current === 'closed') return;
    const remaining = this.openUntil - this.now();
    if (this.current === 'open' && remaining <= 0) {
      this.set('half_open');
    }
    if (this.current === 'open' || this.probing) {
      throw new BreakerOpenError(this.name, Math.max(remaining, 1000));
    }
    this.probing = true;
  }

  /** `healthy`: the provider answered, even if with a refusal. */
  private record(healthy: boolean): void {
    if (healthy) {
      this.failures = 0;
      if (this.current !== 'closed') this.set('closed');
      return;
    }
    this.failures++;
    if (this.current === 'half_open' || this.failures >= this.options.failureThreshold) {
      this.openUntil = this.now() + this.options.openMs;
      if (this.current !== 'open') this.set('open');
    }
  }

  private set(state: BreakerState): void {
    this.current = state;
    this.options.onStateChange?.(state);
  }
}

export interface ResilienceSettings {
  retries: number;
  baseMs: number;
  maxWaitMs: number;
  failureThreshold: number;
  openMs: number;
  onStateChange?: (provider: string, state: BreakerState) => void;
}

/** ADR-016: two retries within ≤ 20 s, five failures in a row open the breaker for 30 s. */
export const DEFAULT_RESILIENCE: ResilienceSettings = {
  retries: 2,
  baseMs: 1000,
  maxWaitMs: 20_000,
  failureThreshold: 5,
  openMs: 30_000,
};

const callOptions = (name: string, code: string, settings: ResilienceSettings) => ({
  breaker: new CircuitBreaker(name, {
    ...settings,
    onStateChange: (state: BreakerState) => settings.onStateChange?.(name, state),
  }),
  code,
  ...settings,
});

export class ResilientSpeechToText implements SpeechToText {
  readonly name: string;
  private readonly options: CallOptions;

  constructor(
    private readonly inner: SpeechToText,
    settings: ResilienceSettings = DEFAULT_RESILIENCE,
  ) {
    this.name = inner.name;
    this.options = callOptions(inner.name, 'stt_unavailable', settings);
  }

  transcribe(
    audio: { path: string; durationSeconds: number },
    signal?: AbortSignal,
  ): Promise<Transcript> {
    return callProvider(() => this.inner.transcribe(audio, signal), { ...this.options, signal });
  }
}

/** Translation and refits share a breaker: they go to the same API. */
export class ResilientTranslator implements Translator {
  readonly name: string;
  private readonly options: CallOptions;

  constructor(
    private readonly inner: Translator,
    settings: ResilienceSettings = DEFAULT_RESILIENCE,
  ) {
    this.name = inner.name;
    this.options = callOptions(inner.name, 'translate_unavailable', settings);
  }

  translate(request: TranslationRequest, signal?: AbortSignal): Promise<Translation> {
    return callProvider(() => this.inner.translate(request, signal), { ...this.options, signal });
  }

  refit(
    request: RefitRequest,
    signal?: AbortSignal,
  ): Promise<{ variants: string[]; usage: TokenUsage }> {
    return callProvider(() => this.inner.refit(request, signal), { ...this.options, signal });
  }
}

/** Transient, with the code the UI explains; `retryAfterMs` reaches the job's backoff. */
export class ProviderUnavailableError extends Error {
  readonly retryAfterMs?: number;

  constructor(code: string, cause: Error & { retryAfterMs?: number }) {
    super(`${code}: ${cause.message}`, { cause });
    this.name = 'ProviderUnavailableError';
    this.retryAfterMs = cause.retryAfterMs;
  }
}

export interface CallOptions {
  breaker: CircuitBreaker;
  /** `stt_unavailable`, `translate_unavailable`. */
  code: string;
  retries: number;
  baseMs: number;
  /** A longer `Retry-After` is left to the next attempt of the job. */
  maxWaitMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
}

/** Overloaded or failing on its side: worth asking again within the attempt. */
const retryableNow = (err: ProviderError) =>
  err.status !== undefined && (err.status === 429 || err.status >= 500);

/**
 * One provider call with retries within the attempt (ADR-016): `429` and `5xx` up to `retries`
 * times, waiting as `Retry-After` says or backing off. A timeout is not retried here: it already
 * took its full time. A refusal becomes a permanent `provider_rejected`.
 */
export async function callProvider<T>(fn: () => Promise<T>, options: CallOptions): Promise<T> {
  const sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  for (let attempt = 0; ; attempt++) {
    try {
      return await options.breaker.run(fn);
    } catch (err) {
      if (options.signal?.aborted) throw err;
      if (err instanceof BreakerOpenError) throw new ProviderUnavailableError(options.code, err);
      if (!(err instanceof ProviderError)) throw err;
      if (err.permanent) throw new PermanentError(err.message, 'provider_rejected');

      const wait = err.retryAfterMs ?? options.baseMs * 2 ** attempt;
      if (attempt >= options.retries || !retryableNow(err) || wait > options.maxWaitMs) {
        throw new ProviderUnavailableError(options.code, err);
      }
      await sleep(wait, options.signal);
    }
  }
}
