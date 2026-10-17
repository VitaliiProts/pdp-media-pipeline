import * as ort from 'onnxruntime-node';
import { trimSilence } from '../lib/wav.mjs';
import { loadTextToSpeech, loadVoiceStyle } from '../vendor/supertonic-helper.js';

/**
 * Silence the model puts around every clip at speed 1 (≈0.5 s before, ≈0.7 s after) and counts
 * in its predicted duration; it shrinks with speed like the speech does.
 */
const PADDING = 1.25;

/**
 * Supertonic 3 on CPU. `predict` runs only the duration predictor (milliseconds), so the
 * speed for a slot is known before the expensive diffusion steps. Both work with the spoken
 * part only: `predict` leaves out the padding and `synthesize` trims it.
 */
export async function createSupertonic({ assets = 'assets', threads = 2, steps = 8 } = {}) {
  const tts = await loadTextToSpeech(`${assets}/onnx`, false, {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
  });
  const styles = new Map();
  const style = (voice) => {
    if (!styles.has(voice)) {
      styles.set(voice, loadVoiceStyle([`${assets}/voice_styles/${voice}.json`]));
    }
    return styles.get(voice);
  };

  return {
    name: 'supertonic-3-local',
    sampleRate: tts.sampleRate,
    voices: ['M1', 'F1', 'M2', 'F2'],

    async predict(text, language, voice) {
      const { textIds, textMask } = tts.textProcessor.call([text], [language]);
      const result = await tts.dpOrt.run({
        text_ids: new ort.Tensor('int64', BigInt64Array.from(textIds[0].map(BigInt)), [
          1,
          textIds[0].length,
        ]),
        style_dp: style(voice).dp,
        text_mask: new ort.Tensor('float32', Float32Array.from(textMask.flat(Infinity)), [
          1,
          1,
          textMask[0][0].length,
        ]),
      });
      return Math.max(0.2, result.duration.data[0] - PADDING);
    },

    async synthesize(text, language, voice, speed) {
      const { wav } = await tts.call(text, language, style(voice), steps, speed);
      return trimSilence(Float32Array.from(wav), tts.sampleRate);
    },
  };
}
