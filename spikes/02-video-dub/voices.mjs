// Every Supertonic 3 voice in every dub language: one listening file per language (voices in
// order, a short pause between them) and the speech rate the translation budget relies on.
//
//   THREADS=2 node voices.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeWav } from './lib/wav.mjs';
import { createSupertonic } from './providers/supertonic.mjs';

const OUT = 'out/voices';
const VOICES = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'];
const GAP = 0.8;

/** The same three lines in each language: plain, with a time of day, and emotional. */
const LINES = {
  uk: [
    'Слухай, нам треба поговорити про те, що сталося вчора.',
    'Зустрінемося о пів на восьму біля старого мосту, добре?',
    'Ти мене взагалі чуєш? Це справді важливо!',
  ],
  de: [
    'Hör zu, wir müssen darüber reden, was gestern passiert ist.',
    'Wir treffen uns um halb acht an der alten Brücke, okay?',
    'Hörst du mir überhaupt zu? Das ist wirklich wichtig!',
  ],
  en: [
    'Listen, we need to talk about what happened yesterday.',
    'Meet me at half past seven by the old bridge, okay?',
    'Are you even listening to me? This really matters!',
  ],
  es: [
    'Escucha, tenemos que hablar de lo que pasó ayer.',
    'Nos vemos a las siete y media junto al puente viejo, ¿vale?',
    '¿Me estás escuchando siquiera? ¡Esto es muy importante!',
  ],
  fr: [
    "Écoute, il faut qu'on parle de ce qui s'est passé hier.",
    'On se retrouve à sept heures et demie près du vieux pont, d’accord ?',
    "Tu m'écoutes au moins ? C'est vraiment important !",
  ],
};

const tts = await createSupertonic({ threads: Number(process.env.THREADS ?? 2) });
mkdirSync(OUT, { recursive: true });
const gap = new Float32Array(Math.round(GAP * tts.sampleRate));
const rates = [];

for (const [language, lines] of Object.entries(LINES)) {
  const parts = [];
  const index = [];
  let at = 0;
  for (const voice of VOICES) {
    index.push(`${voice} ${at.toFixed(1)} s`);
    for (const text of lines) {
      const predicted = await tts.predict(text, language, voice);
      const clip = await tts.synthesize(text, language, voice, 1);
      const seconds = clip.length / tts.sampleRate;
      rates.push({
        language,
        voice,
        chars: text.length,
        words: text.split(/\s+/).length,
        seconds,
        predictError: Math.abs(predicted - seconds),
      });
      parts.push(clip, gap.subarray(0, gap.length / 2));
      at += seconds + GAP / 2;
    }
    parts.push(gap);
    at += GAP;
  }
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.length;
  }
  writeWav(`${OUT}/${language}.wav`, all, tts.sampleRate);
  writeFileSync(`${OUT}/${language}.txt`, `${index.join('\n')}\n`);
  console.log(`${language}: ${OUT}/${language}.wav, ${(all.length / tts.sampleRate).toFixed(0)} s`);
}

const sum = (list, key) => list.reduce((n, r) => n + r[key], 0);
const table = Object.keys(LINES).map((language) => {
  const rows = rates.filter((r) => r.language === language);
  const perVoice = VOICES.map((voice) => {
    const v = rows.filter((r) => r.voice === voice);
    return sum(v, 'chars') / sum(v, 'seconds');
  });
  return {
    language,
    charsPerSec: +(sum(rows, 'chars') / sum(rows, 'seconds')).toFixed(1),
    slowestVoice: +Math.min(...perVoice).toFixed(1),
    fastestVoice: +Math.max(...perVoice).toFixed(1),
    wordsPerSec: +(sum(rows, 'words') / sum(rows, 'seconds')).toFixed(2),
    predictErrorMax: +Math.max(...rows.map((r) => r.predictError)).toFixed(2),
  };
});
console.table(table);
writeFileSync(`${OUT}/rates.json`, JSON.stringify({ table, rates }, null, 1));
