// Ported from github.com/supertone-oss-archive/supertonic (nodejs/helper.js, MIT): one text
// and one voice at a time, typed arrays instead of nested ones, no console output.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type * as Ort from 'onnxruntime-node';

export type OnnxRuntime = typeof Ort;

const LANGUAGES = new Set([
  'en',
  'ko',
  'ja',
  'ar',
  'bg',
  'cs',
  'da',
  'de',
  'el',
  'es',
  'et',
  'fi',
  'fr',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'lt',
  'lv',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'tr',
  'uk',
  'vi',
  'na',
]);

const EMOJI =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

const REPLACEMENTS: [string, string][] = [
  ['–', '-'],
  ['‑', '-'],
  ['—', '-'],
  ['_', ' '],
  ['\u201C', '"'],
  ['\u201D', '"'],
  ['\u2018', "'"],
  ['\u2019', "'"],
  ['´', "'"],
  ['`', "'"],
  ['[', ' '],
  [']', ' '],
  ['|', ' '],
  ['/', ' '],
  ['#', ' '],
  ['→', ' '],
  ['←', ' '],
  ['@', ' at '],
  ['e.g.,', 'for example, '],
  ['i.e.,', 'that is, '],
];

/** The text the model reads: normalised, ending with punctuation, wrapped in language tags. */
export function preprocessText(text: string, language: string): string {
  if (!LANGUAGES.has(language)) throw new Error(`Supertonic does not speak language ${language}`);
  let t = text.normalize('NFKD').replace(EMOJI, '');
  for (const [from, to] of REPLACEMENTS) t = t.replaceAll(from, to);
  t = t
    .replace(/[♥☆♡©\\]/g, '')
    .replace(/ ([,.!?;:'])/g, '$1')
    .replace(/"{2,}/g, '"')
    .replace(/'{2,}/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(t)) t += '.';
  return `<${language}>${t}</${language}>`;
}

const SENTENCE_END =
  /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/;

/** Paragraphs, then sentences packed into chunks of at most `maxLength` characters. */
export function chunkText(text: string, maxLength = 300): string[] {
  const chunks: string[] = [];
  for (const paragraph of text.trim().split(/\n\s*\n+/)) {
    let current = '';
    for (const sentence of paragraph.trim().split(SENTENCE_END)) {
      if (!sentence) continue;
      if (current.length + sentence.length + 1 <= maxLength) {
        current += (current ? ' ' : '') + sentence;
      } else {
        if (current) chunks.push(current.trim());
        current = sentence;
      }
    }
    if (current) chunks.push(current.trim());
  }
  return chunks;
}

interface Config {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
}

interface StyleFile {
  style_ttl: { dims: number[]; data: unknown[] };
  style_dp: { dims: number[]; data: unknown[] };
}

export interface VoiceStyle {
  ttl: Ort.Tensor;
  dp: Ort.Tensor;
}

/** Between chunks of one text. */
const CHUNK_SILENCE_SECONDS = 0.3;

const tensorData = (result: Ort.InferenceSession.OnnxValueMapType, name: string) =>
  (result[name] as Ort.Tensor).data as Float32Array;

export class SupertonicEngine {
  readonly sampleRate: number;

  private constructor(
    private readonly ort: OnnxRuntime,
    private readonly config: Config,
    private readonly indexer: number[],
    private readonly durationPredictor: Ort.InferenceSession,
    private readonly textEncoder: Ort.InferenceSession,
    private readonly vectorEstimator: Ort.InferenceSession,
    private readonly vocoder: Ort.InferenceSession,
  ) {
    this.sampleRate = config.ae.sample_rate;
  }

  static async load(
    ort: OnnxRuntime,
    onnxDir: string,
    options: Ort.InferenceSession.SessionOptions,
  ): Promise<SupertonicEngine> {
    const json = async <T>(name: string) =>
      JSON.parse(await readFile(join(onnxDir, name), 'utf8')) as T;
    const session = (name: string) => ort.InferenceSession.create(join(onnxDir, name), options);
    const [config, indexer, dp, enc, est, voc] = await Promise.all([
      json<Config>('tts.json'),
      json<number[]>('unicode_indexer.json'),
      session('duration_predictor.onnx'),
      session('text_encoder.onnx'),
      session('vector_estimator.onnx'),
      session('vocoder.onnx'),
    ]);
    return new SupertonicEngine(ort, config, indexer, dp, enc, est, voc);
  }

  async loadStyle(path: string): Promise<VoiceStyle> {
    const style = JSON.parse(await readFile(path, 'utf8')) as StyleFile;
    const tensor = ({ dims, data }: StyleFile['style_ttl']) =>
      new this.ort.Tensor('float32', Float32Array.from(data.flat(Infinity) as number[]), dims);
    return { ttl: tensor(style.style_ttl), dp: tensor(style.style_dp) };
  }

  /** Seconds at speed 1, including the silence the model puts around the speech. */
  async duration(text: string, language: string, style: VoiceStyle): Promise<number> {
    const { ids, mask } = this.encode(text, language);
    const result = await this.durationPredictor.run({
      text_ids: ids,
      style_dp: style.dp,
      text_mask: mask,
    });
    return tensorData(result, 'duration')[0]!;
  }

  async synthesize(
    text: string,
    language: string,
    style: VoiceStyle,
    steps: number,
    speed: number,
  ): Promise<Float32Array> {
    const maxLength = language === 'ko' || language === 'ja' ? 120 : 300;
    const parts: Float32Array[] = [];
    for (const chunk of chunkText(text, maxLength)) {
      if (parts.length > 0) {
        parts.push(new Float32Array(Math.floor(CHUNK_SILENCE_SECONDS * this.sampleRate)));
      }
      parts.push(await this.infer(chunk, language, style, steps, speed));
    }
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  private encode(text: string, language: string): { ids: Ort.Tensor; mask: Ort.Tensor } {
    const codes = Array.from(
      preprocessText(text, language),
      (c) => this.indexer[c.charCodeAt(0)] ?? 0,
    );
    return {
      ids: new this.ort.Tensor('int64', BigInt64Array.from(codes, BigInt), [1, codes.length]),
      mask: new this.ort.Tensor('float32', new Float32Array(codes.length).fill(1), [
        1,
        1,
        codes.length,
      ]),
    };
  }

  private async infer(
    text: string,
    language: string,
    style: VoiceStyle,
    steps: number,
    speed: number,
  ): Promise<Float32Array> {
    const { ids, mask } = this.encode(text, language);
    const dp = await this.durationPredictor.run({
      text_ids: ids,
      style_dp: style.dp,
      text_mask: mask,
    });
    const seconds = tensorData(dp, 'duration')[0]! / speed;
    const encoded = await this.textEncoder.run({
      text_ids: ids,
      style_ttl: style.ttl,
      text_mask: mask,
    });

    const chunkSize = this.config.ae.base_chunk_size * this.config.ttl.chunk_compress_factor;
    const latentLength = Math.floor((seconds * this.sampleRate + chunkSize - 1) / chunkSize);
    const latentDim = this.config.ttl.latent_dim * this.config.ttl.chunk_compress_factor;
    const shape = [1, latentDim, latentLength];
    let latent = gaussianNoise(latentDim * latentLength);
    const latentMask = new this.ort.Tensor('float32', new Float32Array(latentLength).fill(1), [
      1,
      1,
      latentLength,
    ]);
    const totalStep = new this.ort.Tensor('float32', Float32Array.of(steps), [1]);

    for (let step = 0; step < steps; step++) {
      const result = await this.vectorEstimator.run({
        noisy_latent: new this.ort.Tensor('float32', latent, shape),
        text_emb: encoded.text_emb!,
        style_ttl: style.ttl,
        text_mask: mask,
        latent_mask: latentMask,
        total_step: totalStep,
        current_step: new this.ort.Tensor('float32', Float32Array.of(step), [1]),
      });
      latent = Float32Array.from(tensorData(result, 'denoised_latent'));
    }
    const voc = await this.vocoder.run({ latent: new this.ort.Tensor('float32', latent, shape) });
    return Float32Array.from(tensorData(voc, 'wav_tts'));
  }
}

/** Box–Muller, as the reference implementation does. */
function gaussianNoise(length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const u1 = Math.max(1e-10, Math.random());
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
  }
  return out;
}
