import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/**
 * A fake OpenAI for the chaos runs (scripts/chaos.sh): transcription, translation and refit
 * answers built from the request, as in test/dub-kill.int-spec.ts. It injects provider faults
 * itself rather than behind a proxy, so it knows which answers count as paid:
 *
 *   paid       200 written to an open connection
 *   abandoned  200 the client no longer waited for
 *   failed     the injected status (500 or 429)
 */
const STEPS = ['transcribe', 'translate', 'refit'];

const emptyCalls = () =>
  Object.fromEntries(STEPS.map((step) => [step, { paid: 0, abandoned: 0, failed: 0 }]));

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res, status, payload, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(payload === undefined ? undefined : JSON.stringify(payload));
}

function parseFaults(raw) {
  const { status, rate, delayMs } = JSON.parse(raw);
  const valid =
    typeof rate === 'number' &&
    rate >= 0 &&
    rate <= 1 &&
    (status === undefined || status === 500 || status === 429) &&
    (delayMs === undefined || (Number.isInteger(delayMs) && delayMs >= 0)) &&
    (status !== undefined || delayMs !== undefined);
  return valid ? { status, rate, delayMs } : undefined;
}

function answer(step, raw) {
  if (step === 'transcribe') {
    return {
      segments: [
        { start: 0.5, end: 3, speaker: 'A', text: 'We should leave before the storm.' },
        { start: 4, end: 6.5, speaker: 'B', text: 'I told you this would happen.' },
      ],
    };
  }
  const request = JSON.parse(raw);
  const user = JSON.parse(request.messages[1].content);
  const content =
    step === 'translate'
      ? {
          sourceLanguage: 'en',
          segments: user.segments.map((s) => ({ id: s.id, variants: [s.text, s.text] })),
        }
      : { variants: [user.fullest] };
  return {
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
}

function stepOf(url, raw) {
  if (url === '/v1/audio/transcriptions') return 'transcribe';
  if (url !== '/v1/chat/completions') return undefined;
  const user = JSON.parse(JSON.parse(raw).messages[1].content);
  return user.segments ? 'translate' : 'refit';
}

export function createMock() {
  let calls = emptyCalls();
  let faults;

  async function provider(res, step, raw) {
    const counts = calls[step];
    const faulty = faults !== undefined && Math.random() < faults.rate;
    if (faulty && faults.delayMs) {
      let gone = false;
      res.on('close', () => (gone = !res.writableFinished));
      await new Promise((resolve) => setTimeout(resolve, faults.delayMs));
      if (gone || res.destroyed) {
        counts.abandoned++;
        return;
      }
    }
    if (faulty && faults.status) {
      counts.failed++;
      const headers = faults.status === 429 ? { 'retry-after': '1' } : {};
      return send(res, faults.status, { error: { message: 'injected fault' } }, headers);
    }
    counts.paid++;
    send(res, 200, answer(step, raw));
  }

  return createServer((req, res) => {
    void body(req)
      .then(async (raw) => {
        const route = `${req.method} ${req.url}`;
        if (route === 'GET /health') return send(res, 200, { ok: true });
        if (route === 'GET /calls') return send(res, 200, calls);
        if (route === 'DELETE /calls') {
          calls = emptyCalls();
          return send(res, 204);
        }
        if (route === 'DELETE /faults') {
          faults = undefined;
          return send(res, 204);
        }
        if (route === 'PUT /faults') {
          const parsed = parseFaults(raw);
          if (!parsed) return send(res, 400, { error: 'expected { status?, rate, delayMs? }' });
          faults = parsed;
          return send(res, 200, faults);
        }
        const step = req.method === 'POST' ? stepOf(req.url, raw) : undefined;
        if (!step) return send(res, 404, { error: `no route ${route}` });
        return provider(res, step, raw);
      })
      .catch((err) => {
        if (!res.headersSent) send(res, 400, { error: String(err) });
      });
  });
}

// A ConfigMap mounts the file through a symlink; import.meta.url is the resolved path.
if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const port = Number(process.env.PORT || 8080);
  createMock().listen(port, () => console.log(`openai-mock on :${port}`));
}
