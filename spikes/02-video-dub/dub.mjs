// The whole dub of one short video, step by step, with timings and a fit report.
//
//   STT=fake|diarize|chunked  TRANSLATOR=fake|openai  node dub.mjs
//
// Paid steps are cached in OUT as JSON, like the processor's checkpoints; FRESH=1 ignores them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { extractSpeechAudio, mixDub, muxDub, probeDuration } from './lib/ffmpeg.mjs';
import { charBudget, MAX_SPEED, placePhrases, tooLong } from './lib/fit.mjs';
import { writeWav } from './lib/wav.mjs';
import { fakeStt, fakeTranslator } from './providers/fake.mjs';
import { openAiChunkedStt, openAiDiarizedStt, openAiTranslator } from './providers/openai.mjs';
import { createSupertonic } from './providers/supertonic.mjs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const env = process.env;
const INPUT = env.INPUT ?? 'input/tos-1min.mp4';
const TARGET = env.TARGET ?? 'de';
const ORIGINAL_TAG = { en: 'eng', de: 'deu', uk: 'ukr', fr: 'fra', es: 'spa' };
const OUT = env.OUT ?? `out/dub-${env.STT ?? 'fake'}-${env.TRANSLATOR ?? 'fake'}`;
const KEY = env.OPENAI_API_KEY;
mkdirSync(OUT, { recursive: true });

/** Hand-labelled speakers of the Tears of Steel clip (0:15–1:15) for the fake recogniser. */
const TOS_SPEAKERS = {
  1: 'celia',
  2: 'thom',
  3: 'thom',
  4: 'celia',
  5: 'thom',
  6: 'thom',
  7: 'thom',
  8: 'thom',
  9: 'celia',
  10: 'robot',
  11: 'scientist',
};

function pick(kind, value) {
  const needKey = () => {
    if (!KEY) throw new Error(`${kind}=${value} needs OPENAI_API_KEY in the environment or .env`);
    return KEY;
  };
  if (kind === 'STT') {
    if (value === 'diarize') return openAiDiarizedStt({ key: needKey() });
    if (value === 'chunked') return openAiChunkedStt({ key: needKey() });
    return fakeStt({ srt: 'input/TOS-en.srt', offset: 15, duration: 60, speakers: TOS_SPEAKERS });
  }
  if (value === 'openai') return openAiTranslator({ key: needKey(), model: env.MODEL });
  return fakeTranslator({ srt: 'input/TOS-de.srt' });
}

const timings = {};
async function step(name, fn) {
  const t0 = performance.now();
  const result = await fn();
  timings[name] = Math.round(performance.now() - t0);
  return result;
}

async function cached(name, fn) {
  const path = join(OUT, `${name}.json`);
  if (existsSync(path) && !env.FRESH) return JSON.parse(readFileSync(path, 'utf8'));
  const result = await fn();
  writeFileSync(path, JSON.stringify(result, null, 2));
  return result;
}

const stt = pick('STT', env.STT ?? 'fake');
const translator = pick('TRANSLATOR', env.TRANSLATOR ?? 'fake');
const tts = await step('load tts', () => createSupertonic({ threads: Number(env.THREADS ?? 2) }));

const duration = await probeDuration(INPUT);
const speechAudio = join(OUT, 'audio-stt.flac');
await step('extract', () => extractSpeechAudio(INPUT, speechAudio));

const transcript = await step('transcribe', () =>
  cached('transcript', () => stt.transcribe(speechAudio, { duration, workDir: OUT })),
);
const segments = transcript.segments;
if (segments.length === 0) throw new Error('no speech');

const translation = await step('translate', () =>
  cached('translation', () =>
    translator.translate(
      segments.map((s, i) => ({ ...s, maxChars: charBudget(segments, i, duration) })),
      TARGET,
    ),
  ),
);
if (translation.sourceLanguage === TARGET) throw new Error(`speech is already ${TARGET}`);
const german = new Map(translation.segments.map((s) => [s.id, s.text]));

const voiceList = env.VOICES ? env.VOICES.split(',') : tts.voices;
const speakers = [...new Set(segments.map((s) => s.speaker))];
const voiceOf = new Map(speakers.map((sp, i) => [sp, voiceList[i % voiceList.length]]));

const lines = segments.map((s) => ({
  ...s,
  voice: voiceOf.get(s.speaker),
  translated: german.get(s.id),
  shortened: false,
}));

const natural = await step('predict', () =>
  Promise.all(lines.map((l) => tts.predict(l.translated, TARGET, l.voice))),
);
const before = tooLong(lines, natural, duration);
await step('shorten', async () => {
  const shorter = await cached('shorter', async () => {
    const result = {};
    for (const i of before) {
      const maxChars = charBudget(lines, i, duration, MAX_SPEED * 0.95);
      result[lines[i].id] = await translator.shorten({ ...lines[i], maxChars }, TARGET);
    }
    return result;
  });
  for (const i of before) {
    const text = shorter[lines[i].id];
    if (!text) continue;
    lines[i].translated = text;
    lines[i].shortened = true;
    natural[i] = await tts.predict(text, TARGET, lines[i].voice);
  }
});

const placed = placePhrases(lines, natural, duration);

const voiceTrack = new Float32Array(Math.ceil(duration * tts.sampleRate));
await step('synthesize', async () => {
  for (const p of placed) {
    const wav = await tts.synthesize(p.translated, TARGET, p.voice, p.speed);
    const at = Math.round(p.place * tts.sampleRate);
    for (let i = 0; i < wav.length && at + i < voiceTrack.length; i++) voiceTrack[at + i] += wav[i];
    p.actual = wav.length / tts.sampleRate;
  }
});
const voiceWav = join(OUT, 'voice.wav');
writeWav(voiceWav, voiceTrack, tts.sampleRate);

const dubAudio = join(OUT, 'dub.m4a');
const output = join(OUT, `dubbed.${TARGET}.mp4`);
await step('mix', () => mixDub(INPUT, voiceWav, dubAudio));
await step('mux', () =>
  muxDub(INPUT, dubAudio, output, {
    target: ORIGINAL_TAG[TARGET] ?? TARGET,
    original: ORIGINAL_TAG[translation.sourceLanguage] ?? translation.sourceLanguage,
  }),
);

const vttTime = (s) => new Date(Math.max(0, s) * 1000).toISOString().slice(11, 23);
writeFileSync(
  join(OUT, `dubbed.${TARGET}.vtt`),
  [
    'WEBVTT',
    '',
    ...placed.map(
      (p) => `${vttTime(p.place)} --> ${vttTime(p.place + p.length)}\n${p.translated}\n`,
    ),
  ].join('\n'),
);

const r2 = (x) => Math.round(x * 100) / 100;
console.log(
  `\nSTT: ${stt.name}; translator: ${translator.name}; TTS: ${tts.name}; output: ${output}`,
);
console.table(
  placed.map((p, i) => ({
    id: p.id,
    voice: `${p.speaker}:${p.voice}`,
    start: r2(p.start),
    slot: r2((placed[i + 1]?.start ?? duration) - p.start),
    chars: p.translated.length,
    natural: r2(p.natural),
    speed: r2(p.speed),
    offset: r2(p.offset),
    overflow: r2(p.overflow),
    short: p.shortened ? 'yes' : '',
    predErr: r2(p.actual - p.length),
  })),
);
const late = placed.filter((p) => p.offset > 0.5);
const report = {
  segments: placed.length,
  speakers: Object.fromEntries(voiceOf),
  spedUp: placed.filter((p) => p.speed > 1.01).length,
  needShorter: before.length,
  shortened: placed.filter((p) => p.shortened).length,
  overflowing: placed.filter((p) => p.overflow > 0.01).length,
  startsLaterThan05s: late.length,
  maxOffset: r2(Math.max(...placed.map((p) => p.offset))),
  timingsMs: timings,
  billed: {
    sttSeconds: r2(transcript.billedSeconds ?? 0),
    ttsChars: placed.reduce((sum, p) => sum + p.translated.length, 0),
    llmTokens: translator.usage ?? null,
  },
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ report, placed }, null, 2));
console.log(report);
