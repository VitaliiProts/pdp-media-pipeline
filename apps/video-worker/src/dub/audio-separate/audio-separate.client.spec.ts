import { ProviderError } from '../providers/provider-error';
import { AudioSeparateClient } from './audio-separate.client';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
const busy = (retryAfter = '0') =>
  new Response('busy', { status: 503, headers: { 'retry-after': retryAfter } });

/** What undici throws when nothing listens behind the Service. */
const refused = () =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  });

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = jest.fn((url: string | URL, init?: RequestInit) => {
    calls.push({ url: url.toString(), body: JSON.parse(init?.body as string) });
    const next = responses.shift() ?? new Error('no more responses');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const client = (fetch: typeof globalThis.fetch, timeoutMs = 60_000) =>
  new AudioSeparateClient({
    baseUrl: 'http://audio-separate:3000',
    timeoutMs,
    notUpWaitMs: 1,
    fetch,
  });

const analysis = {
  segments: [
    {
      id: '1',
      speaker: 'A',
      words: [
        { word: 'Hello', start: 0.42, end: 0.8, score: 0.93 },
        { word: 'there.', start: 0.85, end: 1.3, score: 0.88 },
      ],
    },
  ],
  speakers: [{ id: 'A', gender: 'female', maleProbability: 0.08, seconds: 0.9 }],
  unrecognized: [{ start: 3.1, end: 4 }],
};

describe('AudioSeparateClient', () => {
  it('asks to separate one S3 object into voice and background', async () => {
    const keys = {
      input: 'results/j/dub/audio.flac',
      vocals: 'results/j/dub/vocals.flac',
      background: 'results/j/dub/background.flac',
    };
    const { fetch, calls } = fakeFetch(json({ vocals: keys.vocals, background: keys.background }));

    await expect(client(fetch).separate(keys)).resolves.toEqual({
      vocals: keys.vocals,
      background: keys.background,
    });
    expect(calls).toEqual([{ url: 'http://audio-separate:3000/v1/separate', body: keys }]);
  });

  it('asks to analyse the voice for the segments of the transcript', async () => {
    const request = {
      vocals: 'results/j/dub/vocals.flac',
      segments: [{ id: '1', speaker: 'A', start: 0.3, end: 1.5, text: 'Hello there.' }],
      output: 'results/j/dub/analysis.json',
    };
    const { fetch, calls } = fakeFetch(json(analysis));

    await expect(client(fetch).analyze(request)).resolves.toEqual(analysis);
    expect(calls).toEqual([{ url: 'http://audio-separate:3000/v1/analyze', body: request }]);
  });

  it('waits for a busy pod and asks again', async () => {
    const { fetch, calls } = fakeFetch(busy(), busy(), json(analysis));
    await client(fetch).analyze({ vocals: 'v', segments: [], output: 'o' });
    expect(calls).toHaveLength(3);
  });

  it('gives up on busy pods after its timeout, as a transient failure', async () => {
    const { fetch } = fakeFetch(...Array.from({ length: 50 }, () => busy('0.01')));
    const err = await client(fetch, 50)
      .separate({ input: 'i', vocals: 'v', background: 'b' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({
      permanent: false,
      message: expect.stringContaining('timed out') as string,
    });
  });

  it('waits for a pod that is not up yet', async () => {
    const keys = { input: 'i', vocals: 'v', background: 'b' };
    const { fetch, calls } = fakeFetch(
      refused(),
      refused(),
      json({ vocals: 'v', background: 'b' }),
    );
    await expect(client(fetch).separate(keys)).resolves.toEqual({ vocals: 'v', background: 'b' });
    expect(calls).toHaveLength(3);
  });

  it('gives up on a pod that never comes up after its timeout', async () => {
    const { fetch } = fakeFetch(...Array.from({ length: 500 }, refused));
    await expect(
      client(fetch, 50).separate({ input: 'i', vocals: 'v', background: 'b' }),
    ).rejects.toMatchObject({
      permanent: false,
      message: expect.stringContaining('timed out') as string,
    });
  });

  it('fails at once on other network errors', async () => {
    const { fetch, calls } = fakeFetch(new TypeError('fetch failed'));
    await expect(
      client(fetch).separate({ input: 'i', vocals: 'v', background: 'b' }),
    ).rejects.toMatchObject({
      permanent: false,
      message: expect.stringContaining('fetch failed') as string,
    });
    expect(calls).toHaveLength(1);
  });

  it('takes a missing input as permanent', async () => {
    const { fetch } = fakeFetch(new Response('{"detail":"no such key"}', { status: 404 }));
    await expect(
      client(fetch).separate({ input: 'i', vocals: 'v', background: 'b' }),
    ).rejects.toMatchObject({ status: 404, permanent: true });
  });

  it('takes an answer of another shape as transient', async () => {
    const { fetch } = fakeFetch(json({ speakers: {} }));
    await expect(
      client(fetch).analyze({ vocals: 'v', segments: [], output: 'o' }),
    ).rejects.toMatchObject({ permanent: false });
  });
});
