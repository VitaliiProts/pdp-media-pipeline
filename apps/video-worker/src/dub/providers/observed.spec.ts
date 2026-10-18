import { SpanStatusCode } from '@opentelemetry/api';
import {
  startTestMetrics,
  startTestTracing,
  type TestMetrics,
  type TestTracing,
} from '@pdp/observability/testing';
import { PermanentError } from '@pdp/worker-kit';
import { FakeSpeechToText, FakeTranslator } from './fake';
import { ObservedSpeechToText, ObservedTranslator } from './observed';
import { ProviderUnavailableError } from './resilience';
import { type SpeechToText, type Translator } from './types';

describe('observed providers', () => {
  let tracing: TestTracing;
  let telemetry: TestMetrics;
  beforeEach(() => {
    tracing = startTestTracing();
    telemetry = startTestMetrics();
  });
  afterEach(async () => {
    await telemetry.stop();
    await tracing.stop();
  });

  const audio = { path: '/tmp/speech.flac', durationSeconds: 60 };
  const failing = (err: Error): SpeechToText => ({
    name: 'stt',
    transcribe: () => Promise.reject(err),
  });

  it('spans a call and counts what the provider billed', async () => {
    const stt = new ObservedSpeechToText({
      name: 'stt',
      transcribe: () => Promise.resolve({ segments: [], billedSeconds: 60 }),
    });
    await stt.transcribe(audio);

    const [span] = tracing.spans();
    expect(span?.name).toBe('dub.transcribe');
    expect(span?.attributes).toMatchObject({ 'dub.provider': 'stt', 'dub.cost_usd': 0.0107 });
    await expect(telemetry.value('dub.cost.usd', { provider: 'stt' })).resolves.toBeCloseTo(0.0107);
    await expect(
      telemetry.value('dub.provider.duration', { operation: 'transcribe', outcome: 'ok' }),
    ).resolves.toBe(1);
  });

  it('prices translation and refits by tokens', async () => {
    const inner = new FakeTranslator();
    const translator: Translator = new ObservedTranslator({
      name: 'llm',
      translate: async (request) => ({
        ...(await inner.translate(request)),
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
      }),
      refit: () =>
        Promise.resolve({ variants: [], usage: { inputTokens: 0, outputTokens: 500_000 } }),
    });
    await translator.translate({ targetLanguage: 'uk', sourceLanguage: 'en', lines: [] });
    await translator.refit({
      targetLanguage: 'uk',
      original: 'Hi.',
      fullest: 'Привіт.',
      words: 1,
      before: null,
      after: null,
      speakerGender: 'male',
      listenerGender: 'unknown',
    });
    await expect(telemetry.value('dub.cost.usd', { provider: 'llm' })).resolves.toBeCloseTo(1.25);
  });

  it('tells a refusal, an outage, a cancelled job and a bug apart', async () => {
    const outage = new ProviderUnavailableError('stt_unavailable', new Error('HTTP 503'));
    await expect(
      new ObservedSpeechToText(failing(new PermanentError('bad', 'provider_rejected'))).transcribe(
        audio,
      ),
    ).rejects.toThrow('bad');
    await expect(new ObservedSpeechToText(failing(outage)).transcribe(audio)).rejects.toBe(outage);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      new ObservedSpeechToText(failing(new Error('aborted'))).transcribe(audio, cancelled.signal),
    ).rejects.toThrow('aborted');
    await expect(
      new ObservedSpeechToText(failing(new TypeError('oops'))).transcribe(audio),
    ).rejects.toThrow('oops');

    const outcomes = (await telemetry.points('dub.provider.duration')).map(
      (p) => p.attributes.outcome,
    );
    expect(outcomes.sort()).toEqual(['cancelled', 'error', 'rejected', 'unavailable']);
    expect(tracing.spans().every((s) => s.status.code === SpanStatusCode.ERROR)).toBe(true);
    await expect(telemetry.points('dub.cost.usd')).resolves.toEqual([]);
  });

  it('keeps the name of the provider', () => {
    expect(new ObservedSpeechToText(new FakeSpeechToText()).name).toBe('fake-stt');
  });
});
