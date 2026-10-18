import { isPermanentError } from '@pdp/worker-kit';
import { FakeSpeechToText, FakeTranslator } from './fake';
import { ProviderError } from './provider-error';
import {
  CircuitBreaker,
  callProvider,
  type CallOptions,
  DEFAULT_RESILIENCE,
  ResilientSpeechToText,
  ResilientTranslator,
} from './resilience';
import { type TranslationRequest } from './types';

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    return err as Error & { retryAfterMs?: number; code?: string };
  }
  throw new Error('expected a rejection');
}

const failure = (status?: number, retryAfterMs?: number) =>
  new ProviderError('openai-stt', `HTTP ${status ?? 'timeout'}`, { status, retryAfterMs });

function setup(overrides: Partial<CallOptions> = {}) {
  let now = 0;
  const states: string[] = [];
  const breaker = new CircuitBreaker('openai-stt', {
    failureThreshold: 5,
    openMs: 30_000,
    now: () => now,
    onStateChange: (state) => states.push(state),
  });
  const sleep = jest.fn((_ms: number) => Promise.resolve());
  const options: CallOptions = {
    breaker,
    code: 'stt_unavailable',
    retries: 2,
    baseMs: 1000,
    maxWaitMs: 20_000,
    sleep,
    ...overrides,
  };
  const call = <T>(fn: () => Promise<T>) => callProvider(fn, options);
  return { breaker, sleep, call, states, at: (ms: number) => (now = ms) };
}

describe('callProvider', () => {
  it('retries 429 and 5xx twice, waiting as Retry-After says or backing off', async () => {
    const { call, sleep } = setup();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(failure(429, 3000))
      .mockRejectedValueOnce(failure(503))
      .mockResolvedValueOnce('ok');

    await expect(call(fn)).resolves.toBe('ok');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3000, 2000]);
  });

  it('gives up after two retries with the code of the provider, as transient', async () => {
    const { call } = setup();
    const fn = jest.fn().mockRejectedValue(failure(500));

    const err = await rejection(call(fn));
    expect(fn).toHaveBeenCalledTimes(3);
    expect(err.message).toBe('stt_unavailable: openai-stt: HTTP 500');
    expect(isPermanentError(err)).toBe(false);
  });

  it('leaves a wait longer than 20 s to the next attempt of the job', async () => {
    const { call, sleep } = setup();
    const err = await rejection(call(jest.fn().mockRejectedValue(failure(429, 45_000))));
    expect(sleep).not.toHaveBeenCalled();
    expect(err.retryAfterMs).toBe(45_000);
  });

  it('does not retry a timeout within the attempt', async () => {
    const { call } = setup();
    const fn = jest.fn().mockRejectedValue(failure(undefined));
    await expect(call(fn)).rejects.toThrow('stt_unavailable: ');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('turns a refusal into a permanent provider_rejected', async () => {
    const { call } = setup();
    const err = await rejection(call(jest.fn().mockRejectedValue(failure(400))));
    expect(err).toMatchObject({ code: 'provider_rejected' });
    expect(isPermanentError(err)).toBe(true);
  });

  it('passes errors of its own code through untouched', async () => {
    const { call } = setup();
    const bug = new TypeError('x is undefined');
    await expect(call(jest.fn().mockRejectedValue(bug))).rejects.toBe(bug);
  });

  it('stops at once when the job is cancelled', async () => {
    const controller = new AbortController();
    const { call } = setup({ signal: controller.signal });
    controller.abort();
    const fn = jest.fn().mockRejectedValue(failure(503));
    await expect(call(fn)).rejects.toThrow('HTTP 503');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('resilient providers', () => {
  const settings = { ...DEFAULT_RESILIENCE, baseMs: 1 };

  it('reports recognition outages as stt_unavailable', async () => {
    const stt = new FakeSpeechToText();
    jest.spyOn(stt, 'transcribe').mockRejectedValue(failure(503));
    await expect(
      new ResilientSpeechToText(stt, settings).transcribe({ path: 'a', durationSeconds: 1 }),
    ).rejects.toThrow(/^stt_unavailable: /);
  });

  it('opens one breaker for translation and refits together', async () => {
    const translator = new FakeTranslator();
    const states: string[] = [];
    jest.spyOn(translator, 'translate').mockRejectedValue(failure(503));
    jest.spyOn(translator, 'refit').mockRejectedValue(failure(503));
    const resilient = new ResilientTranslator(translator, {
      ...settings,
      retries: 0,
      onStateChange: (provider, state) => states.push(`${provider} ${state}`),
    });
    const request: TranslationRequest = { targetLanguage: 'uk', sourceLanguage: 'auto', lines: [] };
    for (let i = 0; i < 3; i++) await resilient.translate(request).catch(() => undefined);
    for (let i = 0; i < 2; i++) {
      await resilient
        .refit({
          targetLanguage: 'uk',
          original: 'a',
          fullest: 'a',
          words: 1,
          before: null,
          after: null,
          speakerGender: 'male',
          listenerGender: 'female',
        })
        .catch(() => undefined);
    }
    expect(states).toEqual(['fake-translator open']);
    await expect(resilient.translate(request)).rejects.toThrow(/^translate_unavailable: .*open/);
  });
});

describe('CircuitBreaker', () => {
  it('opens after five transient failures in a row and fails fast until it closes', async () => {
    const { call, breaker, states, at } = setup({ retries: 0 });
    const fn = jest.fn().mockRejectedValue(failure(503));
    for (let i = 0; i < 5; i++) await call(fn).catch(() => undefined);
    expect(breaker.state).toBe('open');

    at(10_000);
    const err = await rejection(call(fn));
    expect(fn).toHaveBeenCalledTimes(5);
    expect(err.message).toMatch(/^stt_unavailable: openai-stt circuit open/);
    expect(err.retryAfterMs).toBe(20_000);
    expect(states).toEqual(['open']);
  });

  it('lets one probe through after 30 s and closes when it succeeds', async () => {
    const { call, breaker, states, at } = setup({ retries: 0 });
    for (let i = 0; i < 5; i++) {
      await call(jest.fn().mockRejectedValue(failure(503))).catch(() => undefined);
    }
    at(30_000);
    let release: (v: string) => void = () => undefined;
    const probe = call(() => new Promise<string>((r) => (release = r)));
    await expect(call(() => Promise.resolve('second'))).rejects.toThrow('circuit open');
    release('ok');
    await expect(probe).resolves.toBe('ok');
    expect(breaker.state).toBe('closed');
    expect(states).toEqual(['open', 'half_open', 'closed']);
  });

  it('opens again when the probe fails', async () => {
    const { call, breaker, at } = setup({ retries: 0 });
    const fn = jest.fn().mockRejectedValue(failure(503));
    for (let i = 0; i < 5; i++) await call(fn).catch(() => undefined);
    at(30_000);
    await call(fn).catch(() => undefined);
    expect(breaker.state).toBe('open');
    at(45_000);
    await expect(call(fn)).rejects.toThrow('circuit open');
  });

  it('counts only failures in a row, and a refusal shows the provider is up', async () => {
    const { call, breaker } = setup({ retries: 0 });
    for (let i = 0; i < 4; i++) {
      await call(jest.fn().mockRejectedValue(failure(503))).catch(() => undefined);
    }
    await call(jest.fn().mockRejectedValue(failure(400))).catch(() => undefined);
    for (let i = 0; i < 4; i++) {
      await call(jest.fn().mockRejectedValue(failure(503))).catch(() => undefined);
    }
    expect(breaker.state).toBe('closed');
  });

  it('ignores errors that do not come from the provider', async () => {
    const { call, breaker } = setup({ retries: 0 });
    for (let i = 0; i < 4; i++) {
      await call(jest.fn().mockRejectedValue(failure(503))).catch(() => undefined);
    }
    await call(jest.fn().mockRejectedValue(new Error('aborted'))).catch(() => undefined);
    await call(jest.fn().mockRejectedValue(failure(503))).catch(() => undefined);
    expect(breaker.state).toBe('open');
  });
});
