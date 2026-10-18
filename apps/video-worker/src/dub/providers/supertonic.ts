import { type DubTargetLanguage, type DubVoice } from '@pdp/contracts';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { trimSilence } from '../audio/trim-silence';
import { type OnnxRuntime, SupertonicEngine, type VoiceStyle } from './supertonic-engine';
import { type TextToSpeech } from './types';

/**
 * Silence the model puts around every clip at speed 1 (≈0.5 s before, ≈0.7 s after) and counts
 * in its predicted duration.
 */
const PADDING_SECONDS = 1.25;
const MIN_SPEECH_SECONDS = 0.2;

export interface SupertonicOptions {
  /** With `onnx/` and `voice_styles/`; baked into the image. */
  assetsDir: string;
  /** ONNX intra-op threads: the CPU limit of the pod. */
  threads: number;
  /** Diffusion steps per clip; 8 was enough in the spike. */
  steps: number;
}

/**
 * Supertonic 3 on CPU. `predict` runs only the duration predictor (milliseconds), so the
 * speed for a slot is known before the expensive diffusion steps.
 */
export class Supertonic implements TextToSpeech {
  readonly name = 'supertonic-3';
  readonly sampleRate: number;
  private readonly styles = new Map<DubVoice, Promise<VoiceStyle>>();

  private constructor(
    private readonly engine: SupertonicEngine,
    private readonly options: SupertonicOptions,
  ) {
    this.sampleRate = engine.sampleRate;
  }

  /** onnxruntime-node is loaded here, so images without it still run the other video jobs. */
  static async load(options: SupertonicOptions): Promise<Supertonic> {
    const onnxDir = join(options.assetsDir, 'onnx');
    await access(join(onnxDir, 'tts.json')).catch(() => {
      throw new Error(`Supertonic model not found in ${options.assetsDir}`);
    });
    // Read when the native library starts: otherwise it reports to Microsoft over 443, which
    // the NetworkPolicy allows, and writes `:memory:.ses` into the working directory.
    process.env.ORT_DISABLE_TELEMETRY = '1';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ort = require('onnxruntime-node') as OnnxRuntime;
    const engine = await SupertonicEngine.load(ort, onnxDir, {
      intraOpNumThreads: options.threads,
      interOpNumThreads: 1,
    });
    return new Supertonic(engine, options);
  }

  async predict(text: string, language: DubTargetLanguage, voice: DubVoice): Promise<number> {
    const seconds = await this.engine.duration(text, language, await this.style(voice));
    return Math.max(MIN_SPEECH_SECONDS, seconds - PADDING_SECONDS);
  }

  async synthesize(
    text: string,
    language: DubTargetLanguage,
    voice: DubVoice,
    speed: number,
  ): Promise<Float32Array> {
    const wav = await this.engine.synthesize(
      text,
      language,
      await this.style(voice),
      this.options.steps,
      speed,
    );
    return trimSilence(wav, this.sampleRate);
  }

  private style(voice: DubVoice): Promise<VoiceStyle> {
    let style = this.styles.get(voice);
    if (!style) {
      style = this.engine.loadStyle(join(this.options.assetsDir, 'voice_styles', `${voice}.json`));
      this.styles.set(voice, style);
    }
    return style;
  }
}
