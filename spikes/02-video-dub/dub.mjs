// The whole dub of one short video, step by step, with timings and a fit report.
//
//   STT=fake|diarize|chunked  TRANSLATOR=fake|fixture|openai  BACKGROUND=separated|ducked
//   node dub.mjs
//
// Paid steps are cached in OUT as JSON, like the processor's checkpoints; FRESH=1 ignores them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  extractSpeechAudio,
  mixDub,
  mixOverBackground,
  muxDub,
  probeDuration,
} from './lib/ffmpeg.mjs';
import {
  charBudget,
  chooseVariant,
  MAX_SPEED,
  placePhrases,
  slotOf,
  speechOf,
  tooLong,
} from './lib/fit.mjs';
import { writeWav } from './lib/wav.mjs';
import { fakeStt, fakeTranslator, fixtureTranslator } from './providers/fake.mjs';
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
const BACKGROUND = env.BACKGROUND ?? 'separated';
const SEPARATED = env.SEPARATED ?? 'out/sep/htdemucs/orig/no_vocals.wav';
// STT_SOURCE=out/sep/htdemucs/orig/vocals.wav recognises the separated voice instead of the mix.
const OUT = env.OUT ?? `out/dub-${env.STT ?? 'fake'}-${env.TRANSLATOR ?? 'fake'}-${BACKGROUND}`;
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
    if (value === 'chunked') {
      const silence = {
        ...(env.NOISE_DB && { noiseDb: Number(env.NOISE_DB) }),
        ...(env.MIN_SILENCE && { minSilence: Number(env.MIN_SILENCE) }),
      };
      return openAiChunkedStt({ key: needKey(), silence });
    }
    return fakeStt({ srt: 'input/TOS-en.srt', offset: 15, duration: 60, speakers: TOS_SPEAKERS });
  }
  if (value === 'openai')
    return openAiTranslator({ key: needKey(), model: env.MODEL, reasoning: env.REASONING });
  if (value === 'fixture') return fixtureTranslator({ path: 'fixtures/tos-de-variants.json' });
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
await step('extract', () => extractSpeechAudio(env.STT_SOURCE ?? INPUT, speechAudio));

const transcript = await step('transcribe', () =>
  cached('transcript', () => stt.transcribe(speechAudio, { duration, workDir: OUT })),
);
const segments = transcript.segments;
if (segments.length === 0) throw new Error('no speech');

const translation = await step('translate', () =>
  cached('translation', () =>
    translator.translate(
      segments.map((s, i) => ({
        ...s,
        seconds: Math.round(speechOf(segments, i, duration) * 10) / 10,
        maxChars: charBudget(segments, i, duration),
      })),
      TARGET,
    ),
  ),
);
if (translation.sourceLanguage === TARGET) throw new Error(`speech is already ${TARGET}`);
const variantsOf = new Map(translation.segments.map((s) => [s.id, s.variants ?? [s.text]]));

const voiceList = env.VOICES ? env.VOICES.split(',') : tts.voices;
const speakers = [...new Set(segments.map((s) => s.speaker))];
const voiceOf = new Map(speakers.map((sp, i) => [sp, voiceList[i % voiceList.length]]));

const lines = segments.map((s) => ({
  ...s,
  voice: voiceOf.get(s.speaker),
  variants: variantsOf.get(s.id),
  shortened: false,
}));

const natural = await step('choose', () =>
  Promise.all(
    lines.map(async (line, i) => {
      const predicted = await Promise.all(
        line.variants.map((v) => tts.predict(v, TARGET, line.voice)),
      );
      line.variant = chooseVariant(
        predicted,
        speechOf(lines, i, duration),
        slotOf(lines, i, duration),
      );
      line.translated = line.variants[line.variant];
      return predicted[line.variant];
    }),
  ),
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
    const predicted = await tts.predict(text, TARGET, lines[i].voice);
    if (predicted >= natural[i]) continue;
    lines[i].translated = text;
    lines[i].shortened = true;
    natural[i] = predicted;
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
await step('mix', () =>
  BACKGROUND === 'ducked'
    ? mixDub(INPUT, voiceWav, dubAudio)
    : mixOverBackground(SEPARATED, voiceWav, dubAudio),
);
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
    speech: r2(speechOf(placed, i, duration)),
    slot: r2(slotOf(placed, i, duration)),
    variant: `${p.variant + 1}/${p.variants.length}`,
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
