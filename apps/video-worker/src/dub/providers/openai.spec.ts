import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAiSpeechToText, OpenAiTranslator } from './openai';
import { ProviderError } from './provider-error';
import { type TranslationRequest } from './types';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = jest.fn((url: string | URL, init?: RequestInit) => {
    calls.push({ url: url.toString(), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const bodyOf = (init: RequestInit) => JSON.parse(init.body as string) as Record<string, unknown>;
const completion = (content: unknown, usage = { prompt_tokens: 100, completion_tokens: 40 }) =>
  json({
    choices: [
      { finish_reason: 'stop', message: { content: JSON.stringify(content), refusal: null } },
    ],
    usage,
  });

describe('OpenAiSpeechToText', () => {
  let dir: string;
  let audio: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stt-'));
    audio = join(dir, 'audio.flac');
    await writeFile(audio, Buffer.from('fLaC'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const stt = (fetch: typeof globalThis.fetch) =>
    new OpenAiSpeechToText({
      apiKey: 'sk-test',
      baseUrl: 'https://api.test/v1',
      fetch,
      timeoutMs: 60_000,
    });

  it('sends the audio to the diarizing model and numbers the segments with text', async () => {
    const { fetch, calls } = fakeFetch(
      json({
        segments: [
          { id: 'seg_0', start: 0.4, end: 2.1, text: ' Hello there. ', speaker: 'A' },
          { id: 'seg_1', start: 2.3, end: 2.5, text: '  ', speaker: 'B' },
          { id: 'seg_2', start: 2.6, end: 4, text: 'Hi.', speaker: 'B' },
        ],
      }),
    );

    const transcript = await stt(fetch).transcribe({ path: audio, durationSeconds: 42 });

    expect(transcript).toEqual({
      segments: [
        { id: '1', start: 0.4, end: 2.1, text: 'Hello there.', speaker: 'A' },
        { id: '2', start: 2.6, end: 4, text: 'Hi.', speaker: 'B' },
      ],
      billedSeconds: 42,
    });
    expect(calls[0]?.url).toBe('https://api.test/v1/audio/transcriptions');
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer sk-test');
    const form = calls[0]?.init.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-transcribe-diarize');
    expect(form.get('response_format')).toBe('diarized_json');
    expect(form.get('chunking_strategy')).toBe('auto');
    expect((form.get('file') as File).name).toBe('audio.flac');
  });

  it('reports a rate limit as transient with the time to wait', async () => {
    const { fetch } = fakeFetch(
      new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }),
    );
    const err = await stt(fetch)
      .transcribe({ path: audio, durationSeconds: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 7000, permanent: false });
  });

  it('reports a rejected request as permanent', async () => {
    const { fetch } = fakeFetch(new Response('{"error":"bad audio"}', { status: 400 }));
    await expect(stt(fetch).transcribe({ path: audio, durationSeconds: 1 })).rejects.toMatchObject({
      status: 400,
      permanent: true,
    });
  });

  it('reports an answer of an unexpected shape as transient', async () => {
    const { fetch } = fakeFetch(json({ text: 'no segments' }));
    await expect(stt(fetch).transcribe({ path: audio, durationSeconds: 1 })).rejects.toMatchObject({
      permanent: false,
    });
  });

  it('gives up after its timeout', async () => {
    const fetch = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error)),
        ),
    ) as unknown as typeof globalThis.fetch;
    const slow = new OpenAiSpeechToText({ apiKey: 'k', fetch, timeoutMs: 20 });
    await expect(slow.transcribe({ path: audio, durationSeconds: 1 })).rejects.toThrow(
      'timed out after 20 ms',
    );
  });

  it('lets a shutdown abort through as it is', async () => {
    const controller = new AbortController();
    const fetch = jest.fn(() => {
      controller.abort(new Error('shutting down'));
      return Promise.reject(controller.signal.reason as Error);
    }) as unknown as typeof globalThis.fetch;
    await expect(
      stt(fetch).transcribe({ path: audio, durationSeconds: 1 }, controller.signal),
    ).rejects.toThrow('shutting down');
  });
});

describe('OpenAiTranslator', () => {
  const translator = (fetch: typeof globalThis.fetch) =>
    new OpenAiTranslator({
      apiKey: 'sk-test',
      baseUrl: 'https://api.test/v1',
      fetch,
      model: 'gpt-5-mini',
      reasoningEffort: 'low',
      translateTimeoutMs: 60_000,
      refitTimeoutMs: 30_000,
    });
  const request: TranslationRequest = {
    targetLanguage: 'uk',
    sourceLanguage: 'auto',
    lines: [
      {
        id: '1',
        turn: '1',
        speaker: 'A',
        speakerGender: 'female',
        listenerGender: 'male',
        text: 'I was tired.',
        seconds: 1.2,
        maxChars: 20,
      },
      {
        id: '2',
        turn: '2',
        speaker: 'B',
        speakerGender: 'male',
        listenerGender: 'female',
        text: 'Go home.',
        seconds: 0.8,
        maxChars: 14,
      },
    ],
  };

  it('asks for three phrasings of every line under a strict schema', async () => {
    const { fetch, calls } = fakeFetch(
      completion({
        sourceLanguage: 'en',
        segments: [
          { id: '2', variants: ['Іди додому.', 'Додому.'] },
          { id: '1', variants: ['Я була втомлена.', 'Я втомилась.', ' '] },
        ],
      }),
    );

    const result = await translator(fetch).translate(request);

    expect(result).toEqual({
      sourceLanguage: 'en',
      lines: [
        { id: '1', variants: ['Я була втомлена.', 'Я втомилась.'] },
        { id: '2', variants: ['Іди додому.', 'Додому.'] },
      ],
      usage: { inputTokens: 100, outputTokens: 40 },
    });
    expect(calls[0]?.url).toBe('https://api.test/v1/chat/completions');
    const body = bodyOf(calls[0]!.init);
    expect(body).toMatchObject({
      model: 'gpt-5-mini',
      reasoning_effort: 'low',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'dub_translation', strict: true },
      },
    });
    const [system, user] = body.messages as { role: string; content: string }[];
    expect(system?.content).toContain('three natural spoken phrasings');
    expect(JSON.parse(user!.content)).toEqual({
      targetLanguage: 'uk',
      sourceLanguage: 'auto',
      segments: request.lines,
    });
  });

  it('fails when a line is missing or has no phrasing', async () => {
    const missing = fakeFetch(
      completion({ sourceLanguage: 'en', segments: [{ id: '1', variants: ['Так.'] }] }),
    );
    await expect(translator(missing.fetch).translate(request)).rejects.toThrow('every line');

    const empty = fakeFetch(
      completion({
        sourceLanguage: 'en',
        segments: [
          { id: '1', variants: ['Так.'] },
          { id: '2', variants: [''] },
        ],
      }),
    );
    await expect(translator(empty.fetch).translate(request)).rejects.toThrow('every line');
  });

  it('takes a refusal as permanent', async () => {
    const { fetch } = fakeFetch(
      json({
        choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'I cannot help.' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
    await expect(translator(fetch).translate(request)).rejects.toMatchObject({
      permanent: true,
      message: expect.stringContaining('refused') as string,
    });
  });

  it('refits one line to a number of words with its neighbours as context', async () => {
    const { fetch, calls } = fakeFetch(
      completion(
        { variants: ['Я втомилась.', 'Я дуже втомилась.', ''] },
        { prompt_tokens: 50, completion_tokens: 10 },
      ),
    );

    const result = await translator(fetch).refit({
      targetLanguage: 'uk',
      original: 'I was tired.',
      fullest: 'Я була дуже-дуже втомлена.',
      words: 3,
      before: null,
      after: 'Іди додому.',
      speakerGender: 'female',
      listenerGender: 'male',
    });

    expect(result).toEqual({
      variants: ['Я втомилась.', 'Я дуже втомилась.'],
      usage: { inputTokens: 50, outputTokens: 10 },
    });
    const body = bodyOf(calls[0]!.init);
    expect(body).toMatchObject({ response_format: { json_schema: { name: 'dub_refit' } } });
    const [system, user] = body.messages as { content: string }[];
    expect(system?.content).toContain('never adds a statement');
    expect(JSON.parse(user!.content)).toMatchObject({
      original: 'I was tired.',
      words: 3,
      after: 'Іди додому.',
    });
  });
});
