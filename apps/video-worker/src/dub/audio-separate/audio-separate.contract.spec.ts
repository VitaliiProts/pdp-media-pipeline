import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnalyzeRequest, SeparateRequest } from './audio-separate.api';
import { AudioSeparateClient } from './audio-separate.client';

/** The examples the service is tested against (apps/audio-separate/tests/test_contract.py). */
const CONTRACT = join(__dirname, '../../../../audio-separate/contract');
const example = (name: string): unknown =>
  JSON.parse(readFileSync(join(CONTRACT, `${name}.json`), 'utf8'));

function serviceAnswering(response: unknown) {
  const sent: { path: string; body: unknown }[] = [];
  const fetch = jest.fn((url: string | URL, init?: RequestInit) => {
    sent.push({ path: new URL(url).pathname, body: JSON.parse(init?.body as string) });
    return Promise.resolve(
      new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } }),
    );
  });
  const client = new AudioSeparateClient({
    baseUrl: 'http://audio-separate:3000',
    timeoutMs: 1000,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { client, sent };
}

describe('audio-separate contract', () => {
  it('sends a separation request the service accepts and reads its answer', async () => {
    const request = SeparateRequest.strict().parse(example('separate.request'));
    const { client, sent } = serviceAnswering(example('separate.response'));

    const result = await client.separate(request);

    expect(sent).toEqual([{ path: '/v1/separate', body: example('separate.request') }]);
    expect(result).toEqual(example('separate.response'));
  });

  it('sends an analysis request the service accepts and reads every field of its answer', async () => {
    const request = AnalyzeRequest.strict().parse(example('analyze.request'));
    const { client, sent } = serviceAnswering(example('analyze.response'));

    const result = await client.analyze(request);

    expect(sent).toEqual([{ path: '/v1/analyze', body: example('analyze.request') }]);
    expect(result).toEqual(example('analyze.response'));
  });
});
