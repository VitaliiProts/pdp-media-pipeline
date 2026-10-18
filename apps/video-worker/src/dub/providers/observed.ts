import { SpanKind } from '@opentelemetry/api';
import { traced } from '@pdp/observability';
import { PermanentError } from '@pdp/worker-kit';
import { performance } from 'node:perf_hooks';
import {
  type AnalyzeRequest,
  type AnalyzeResponse,
  type SeparateRequest,
  type SeparateResponse,
} from '../audio-separate/audio-separate.api';
import { type AudioSeparate } from '../audio-separate/audio-separate.client';
import { dubMetrics, type ProviderOutcome } from '../dub-metrics';
import { sttCostUsd, tokenCostUsd } from '../dub-usage';
import { ProviderUnavailableError } from './resilience';
import {
  type RefitRequest,
  type SpeechToText,
  type TokenUsage,
  type Transcript,
  type Translation,
  type TranslationRequest,
  type Translator,
} from './types';

function outcomeOf(err: unknown, signal?: AbortSignal): ProviderOutcome {
  if (signal?.aborted) return 'cancelled';
  if (err instanceof PermanentError) return 'rejected';
  if (err instanceof ProviderUnavailableError) return 'unavailable';
  return 'error';
}

/** Our own audio-separate pods: no spend series for them. */
const free = (): number => 0;

/**
 * A span and a duration per call as the processor sees it; the HTTP requests of its retries
 * are child spans. Spend is counted when the provider answers, so failed attempts add to it.
 */
async function observe<T>(
  provider: string,
  operation: string,
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
  costOf: (result: T) => number = free,
): Promise<T> {
  const start = performance.now();
  const seconds = () => (performance.now() - start) / 1000;
  return traced(
    `dub.${operation}`,
    { kind: SpanKind.CLIENT, attributes: { 'dub.provider': provider } },
    async (span) => {
      try {
        const result = await fn();
        const cost = costOf(result);
        span.setAttribute('dub.cost_usd', cost);
        if (costOf !== free) dubMetrics.cost(provider, cost);
        dubMetrics.providerCall(provider, operation, 'ok', seconds());
        return result;
      } catch (err) {
        dubMetrics.providerCall(provider, operation, outcomeOf(err, signal), seconds());
        throw err;
      }
    },
  );
}

export class ObservedSpeechToText implements SpeechToText {
  readonly name: string;

  constructor(private readonly inner: SpeechToText) {
    this.name = inner.name;
  }

  transcribe(
    audio: { path: string; durationSeconds: number },
    signal?: AbortSignal,
  ): Promise<Transcript> {
    return observe(
      this.name,
      'transcribe',
      signal,
      () => this.inner.transcribe(audio, signal),
      (t) => sttCostUsd(t.billedSeconds),
    );
  }
}

export class ObservedTranslator implements Translator {
  readonly name: string;

  constructor(private readonly inner: Translator) {
    this.name = inner.name;
  }

  translate(request: TranslationRequest, signal?: AbortSignal): Promise<Translation> {
    return observe(
      this.name,
      'translate',
      signal,
      () => this.inner.translate(request, signal),
      (t) => tokenCostUsd(t.usage),
    );
  }

  refit(
    request: RefitRequest,
    signal?: AbortSignal,
  ): Promise<{ variants: string[]; usage: TokenUsage }> {
    return observe(
      this.name,
      'refit',
      signal,
      () => this.inner.refit(request, signal),
      (r) => tokenCostUsd(r.usage),
    );
  }
}

export class ObservedAudioSeparate implements AudioSeparate {
  constructor(private readonly inner: AudioSeparate) {}

  separate(request: SeparateRequest, signal?: AbortSignal): Promise<SeparateResponse> {
    return observe('audio-separate', 'separate', signal, () =>
      this.inner.separate(request, signal),
    );
  }

  analyze(request: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse> {
    return observe('audio-separate', 'analyze', signal, () => this.inner.analyze(request, signal));
  }
}
