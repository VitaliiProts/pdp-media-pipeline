// Supertonic 3 on CPU, German: load cost, synthesis speed, speech rate, and whether the
// duration predictor alone tells the clip length before the expensive denoising steps.
//
//   THREADS=2 STEPS=8 node tts-bench.mjs
import { mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as ort from 'onnxruntime-node';
import { loadTextToSpeech, loadVoiceStyle, writeWavFile } from './vendor/supertonic-helper.js';

const THREADS = Number(process.env.THREADS ?? 2);
const STEPS = Number(process.env.STEPS ?? 8);
const LANG = process.env.LANG_CODE ?? 'de';
const OUT = 'out/tts';

const PHRASES = [
  'Hallo zusammen.',
  'Heute zeige ich euch, wie man ein Video hochlädt.',
  'Zuerst öffnet ihr die Mediathek und klickt oben rechts auf „Hochladen“.',
  'Das dauert normalerweise nur ein paar Sekunden, je nachdem, wie groß die Datei ist und wie schnell eure Verbindung ist.',
  'Wenn die Verarbeitung abgeschlossen ist, erscheint das Video mit allen Versionen in der Liste, und ihr könnt es direkt abspielen, herunterladen oder löschen.',
  'Am 14. März 2027 um 9:30 Uhr kostet es 3,50 € pro Minute – also etwa 12 % weniger.',
];

const mb = (bytes) => Math.round(bytes / 2 ** 20);
const ms = (t0) => Math.round(performance.now() - t0);

function predictSeconds(tts, text, style) {
  const { textIds, textMask } = tts.textProcessor.call([text], [LANG]);
  const ids = new ort.Tensor('int64', BigInt64Array.from(textIds[0].map(BigInt)), [
    1,
    textIds[0].length,
  ]);
  const mask = new ort.Tensor('float32', Float32Array.from(textMask.flat(Infinity)), [
    1,
    1,
    textMask[0][0].length,
  ]);
  return tts.dpOrt
    .run({ text_ids: ids, style_dp: style.dp, text_mask: mask })
    .then((r) => r.duration.data[0]);
}

mkdirSync(OUT, { recursive: true });
const rssBefore = process.memoryUsage().rss;
let t0 = performance.now();
const tts = await loadTextToSpeech('assets/onnx', false, {
  intraOpNumThreads: THREADS,
  interOpNumThreads: 1,
});
console.log(
  `load ${ms(t0)} ms, rss +${mb(process.memoryUsage().rss - rssBefore)} MiB, threads ${THREADS}, steps ${STEPS}`,
);

const rows = [];
for (const voice of ['M1', 'F1']) {
  const style = loadVoiceStyle([`assets/voice_styles/${voice}.json`]);
  for (const [i, text] of PHRASES.entries()) {
    t0 = performance.now();
    const predicted = await predictSeconds(tts, text, style);
    const predictMs = ms(t0);

    for (const speed of [1.0, 1.3]) {
      t0 = performance.now();
      const { wav } = await tts.call(text, LANG, style, STEPS, speed);
      const synthMs = ms(t0);
      const audio = wav.length / tts.sampleRate;
      writeWavFile(`${OUT}/${voice}-${i}-x${speed}.wav`, wav, tts.sampleRate);
      rows.push({
        voice,
        phrase: i,
        chars: text.length,
        speed,
        predicted: +(predicted / speed).toFixed(2),
        audio: +audio.toFixed(2),
        charsPerSec: +(text.length / audio).toFixed(1),
        predictMs,
        synthMs,
        rtf: +(synthMs / 1000 / audio).toFixed(3),
      });
    }
  }
}
console.table(rows);

const plain = rows.filter((r) => r.speed === 1.0);
const total = (key, list = plain) => list.reduce((sum, r) => sum + r[key], 0);
console.log(
  [
    `speech rate at speed 1.0: ${(total('chars') / total('audio')).toFixed(1)} chars/s`,
    `CPU time per minute of speech: ${((total('synthMs', rows) / 1000 / total('audio', rows)) * 60).toFixed(1)} s`,
    `predicted vs actual length, worst: ${Math.max(...rows.map((r) => Math.abs(r.audio - r.predicted))).toFixed(2)} s`,
    `peak rss ${mb(process.memoryUsage().rss)} MiB, sample rate ${tts.sampleRate} Hz`,
  ].join('\n'),
);
