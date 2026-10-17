import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cutAudio, speechIntervals } from '../lib/ffmpeg.mjs';

const API = 'https://api.openai.com/v1';
const TIMEOUT_MS = 120_000;

async function request(key, path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`OpenAI ${path} ${res.status}: ${(await res.text()).slice(0, 500)}`);
    err.status = res.status;
    err.retryAfter = res.headers.get('retry-after');
    throw err;
  }
  return res.json();
}

function audioForm(path, fields) {
  const form = new FormData();
  form.set('file', new Blob([readFileSync(path)], { type: 'audio/flac' }), basename(path));
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

export function openAiDiarizedStt({ key }) {
  return {
    name: 'gpt-4o-transcribe-diarize',
    async transcribe(audioPath, { duration }) {
      const body = await request(key, '/audio/transcriptions', {
        method: 'POST',
        body: audioForm(audioPath, {
          model: 'gpt-4o-transcribe-diarize',
          response_format: 'diarized_json',
          chunking_strategy: 'auto',
        }),
      });
      const segments = body.segments
        .filter((s) => s.text?.trim())
        .map((s, i) => ({
          id: String(i + 1),
          start: s.start,
          end: s.end,
          text: s.text.trim(),
          speaker: s.speaker,
        }));
      return { segments, billedSeconds: duration, raw: body };
    },
  };
}

/** No timestamps from the model: the speech intervals between pauses become the segments. */
export function openAiChunkedStt({ key, silence = {} }) {
  return {
    name: 'gpt-4o-transcribe + silencedetect',
    async transcribe(audioPath, { duration, workDir }) {
      const intervals = await speechIntervals(audioPath, duration, silence);
      const segments = [];
      for (const [i, interval] of intervals.entries()) {
        const chunk = join(workDir, `chunk-${i}.flac`);
        await cutAudio(audioPath, interval.start, interval.end, chunk);
        const body = await request(key, '/audio/transcriptions', {
          method: 'POST',
          body: audioForm(chunk, { model: 'gpt-4o-transcribe', response_format: 'json' }),
        });
        if (body.text?.trim()) {
          segments.push({ id: String(i + 1), ...interval, text: body.text.trim(), speaker: 'A' });
        }
      }
      const billedSeconds = intervals.reduce((sum, x) => sum + x.end - x.start, 0);
      return { segments, billedSeconds, intervals };
    },
  };
}

const SYSTEM = [
  'You translate speech for dubbing. Each line will be spoken by a synthetic voice in the',
  '`seconds` the original speaker took, so its spoken length should match: `maxChars` is a rough',
  'limit. For every line give three natural spoken phrasings, each clearly shorter than the one',
  'before: the first is a faithful translation that fits, the last keeps only the core meaning.',
  'Never change who does what or the meaning. Keep tone and register.',
  'Write numbers, dates, times and units out the way they are spoken. Return every id once.',
].join(' ');

const SHORTEN_SYSTEM = [
  'You shorten one dubbing line that is too long to be spoken in its time slot.',
  'Return a single natural spoken phrasing in the target language within maxChars, keeping the',
  'core meaning of the original; drop filler first. One phrasing only, no lists or numbering.',
].join(' ');

function jsonSchema(name, schema) {
  return { type: 'json_schema', json_schema: { name, strict: true, schema } };
}

const TRANSLATION_SCHEMA = jsonSchema('dub_translation', {
  type: 'object',
  additionalProperties: false,
  required: ['sourceLanguage', 'segments'],
  properties: {
    sourceLanguage: { type: 'string', description: 'ISO 639-1 code of the original speech' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'variants'],
        properties: {
          id: { type: 'string' },
          variants: {
            type: 'array',
            description: 'Three phrasings from the fullest to the shortest',
            items: { type: 'string' },
          },
        },
      },
    },
  },
});

const SHORTER_SCHEMA = jsonSchema('dub_shorter', {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string' } },
});

export function openAiTranslator({ key, model = 'gpt-5-mini', reasoning }) {
  const usage = { input: 0, output: 0, reasoning: 0 };
  async function complete(messages, responseFormat) {
    const body = await request(key, '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        response_format: responseFormat,
        ...(reasoning && { reasoning_effort: reasoning }),
      }),
    });
    usage.input += body.usage?.prompt_tokens ?? 0;
    usage.output += body.usage?.completion_tokens ?? 0;
    usage.reasoning += body.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    return JSON.parse(body.choices[0].message.content);
  }

  return {
    name: model,
    usage,
    async translate(segments, target) {
      const result = await complete(
        [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              targetLanguage: target,
              segments: segments.map(({ id, text, seconds, maxChars }) => ({
                id,
                text,
                seconds,
                maxChars,
              })),
            }),
          },
        ],
        TRANSLATION_SCHEMA,
      );
      const ids = new Set(segments.map((s) => s.id));
      if (result.segments.length !== ids.size || !result.segments.every((s) => ids.has(s.id))) {
        throw new Error('translation does not return every segment exactly once');
      }
      return { ...result, usage };
    },
    async shorten({ text, translated, maxChars }, target) {
      const result = await complete(
        [
          { role: 'system', content: SHORTEN_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              targetLanguage: target,
              original: text,
              tooLong: translated,
              maxChars,
              instruction: 'Rephrase tooLong so it fits maxChars; drop filler before meaning.',
            }),
          },
        ],
        SHORTER_SCHEMA,
      );
      return result.text;
    },
  };
}
