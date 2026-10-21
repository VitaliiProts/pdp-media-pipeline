import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createMock } from './server.mjs';

const transcribe = (base, init = {}) =>
  fetch(`${base}/v1/audio/transcriptions`, { method: 'POST', body: 'audio', ...init });

const chat = (base, user) =>
  fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ content: 'system' }, { content: JSON.stringify(user) }] }),
  });

const json = (base, path, method = 'GET', body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((r) => (r.status === 204 ? undefined : r.json()));

describe('openai-mock', () => {
  const server = createMock();
  let base;

  before(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  beforeEach(async () => {
    await json(base, '/calls', 'DELETE');
    await json(base, '/faults', 'DELETE');
  });

  it('answers each step and counts it as paid', async () => {
    const transcript = await (await transcribe(base)).json();
    assert.equal(transcript.segments.length, 2);

    const translation = await (
      await chat(base, { segments: [{ id: 's1', text: 'Hello.' }] })
    ).json();
    assert.deepEqual(JSON.parse(translation.choices[0].message.content).segments, [
      { id: 's1', variants: ['Hello.', 'Hello.'] },
    ]);

    const refit = await (await chat(base, { fullest: 'Hello there.' })).json();
    assert.deepEqual(JSON.parse(refit.choices[0].message.content), {
      variants: ['Hello there.'],
    });

    assert.deepEqual(await json(base, '/calls'), {
      transcribe: { paid: 1, abandoned: 0, failed: 0 },
      translate: { paid: 1, abandoned: 0, failed: 0 },
      refit: { paid: 1, abandoned: 0, failed: 0 },
    });
  });

  it('fails a share of the calls with the configured status', async () => {
    await json(base, '/faults', 'PUT', { status: 429, rate: 1 });

    const res = await transcribe(base);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '1');
    assert.deepEqual((await json(base, '/calls')).transcribe, { paid: 0, abandoned: 0, failed: 1 });

    await json(base, '/faults', 'DELETE');
    assert.equal((await transcribe(base)).status, 200);
  });

  it('counts an answer the client stopped waiting for as abandoned', async () => {
    await json(base, '/faults', 'PUT', { rate: 1, delayMs: 300 });

    await assert.rejects(transcribe(base, { signal: AbortSignal.timeout(50) }));
    await new Promise((resolve) => setTimeout(resolve, 400));

    assert.deepEqual((await json(base, '/calls')).transcribe, { paid: 0, abandoned: 1, failed: 0 });
  });

  it('rejects a fault with a rate outside 0..1', async () => {
    const res = await fetch(`${base}/faults`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 500, rate: 2 }),
    });
    assert.equal(res.status, 400);
  });
});
