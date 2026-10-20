import { setTimeout as sleep } from 'node:timers/promises';
import { type z } from 'zod';
import { parseRetryAfter, ProviderError } from '../providers/provider-error';
import {
  type AnalyzeRequest,
  AnalyzeResponse,
  type SeparateRequest,
  SeparateResponse,
} from './audio-separate.api';

const PROVIDER = 'audio-separate';
/** When a busy pod gives no `Retry-After`. */
const DEFAULT_BUSY_WAIT_MS = 2000;
const MAX_BUSY_WAIT_MS = 20_000;

export interface AudioSeparate {
  separate(request: SeparateRequest, signal?: AbortSignal): Promise<SeparateResponse>;
  analyze(request: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse>;
}

export interface AudioSeparateClientOptions {
  baseUrl: string;
  /** For the whole call, waits for a busy pod or a starting one included. */
  timeoutMs: number;
  /** Between attempts while the Service has no pod to connect to. */
  notUpWaitMs?: number;
  fetch?: typeof fetch;
}

/** Nothing listens behind the Service: no pod yet, as from zero the dub starts both at once. */
const isNotUp = (err: unknown): boolean =>
  (err as { cause?: { code?: unknown } } | null)?.cause?.code === 'ECONNREFUSED';

/**
 * A pod takes one request at a time and answers `503` while busy; the client waits as told
 * and asks again, which the Service may route to another pod. A refused connection is waited
 * out the same way: started from zero, the pod pulls a 2.3 GB image while video-dub is up in
 * a second, and the attempts of the job would be gone long before it.
 */
export class AudioSeparateClient implements AudioSeparate {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: AudioSeparateClientOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  separate(request: SeparateRequest, signal?: AbortSignal): Promise<SeparateResponse> {
    return this.post('/v1/separate', request, SeparateResponse, signal);
  }

  analyze(request: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse> {
    return this.post('/v1/analyze', request, AnalyzeResponse, signal);
  }

  private async post<T>(
    path: string,
    body: object,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const fail = (err: unknown): never => {
      if (signal?.aborted) throw err;
      if (timeout.aborted) {
        throw new ProviderError(PROVIDER, `${path} timed out after ${this.options.timeoutMs} ms`);
      }
      throw new ProviderError(PROVIDER, `${path} failed: ${(err as Error).message}`);
    };

    for (;;) {
      let res: Response;
      try {
        res = await this.fetch(new URL(path, this.options.baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: combined,
        });
      } catch (err) {
        if (combined.aborted || !isNotUp(err)) return fail(err);
        const wait = this.options.notUpWaitMs ?? DEFAULT_BUSY_WAIT_MS;
        await sleep(wait, undefined, { signal: combined }).catch(fail);
        continue;
      }
      if (res.status === 503) {
        const wait = parseRetryAfter(res.headers.get('retry-after')) ?? DEFAULT_BUSY_WAIT_MS;
        await res.body?.cancel();
        await sleep(Math.min(wait, MAX_BUSY_WAIT_MS), undefined, { signal: combined }).catch(fail);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ProviderError(PROVIDER, `${path} ${res.status}: ${text.slice(0, 300)}`, {
          status: res.status,
        });
      }
      const parsed = schema.safeParse(await res.json().catch(fail));
      if (!parsed.success) {
        throw new ProviderError(PROVIDER, `unexpected answer of ${path}: ${parsed.error.message}`);
      }
      return parsed.data;
    }
  }
}
