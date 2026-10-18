import { z } from 'zod';
import { type AudioSeparate, AudioSeparateClient } from './audio-separate/audio-separate.client';
import { FakeAudioSeparate } from './audio-separate/fake-audio-separate';
import { type DubStorage } from './checkpoints';
import { FakeSpeechToText, FakeTextToSpeech, FakeTranslator } from './providers/fake';
import { OPENAI_BASE_URL, OpenAiSpeechToText, OpenAiTranslator } from './providers/openai';
import { Supertonic } from './providers/supertonic';
import { type SpeechToText, type TextToSpeech, type Translator } from './providers/types';

const ms = (fallback: number) => z.coerce.number().int().min(10).default(fallback);

export const dubEnvSchema = z.object({
  /** Recognition and translation; `fake` needs no key, for tests, k6 and k3d. */
  DUB_PROVIDERS: z.enum(['openai', 'fake']).default('openai'),
  /** `fake` needs no model, for tests without the 400 MB of weights. */
  DUB_TTS: z.enum(['supertonic', 'fake']).default('supertonic'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.url().default(OPENAI_BASE_URL),
  DUB_TRANSLATE_MODEL: z.string().min(1).default('gpt-5-mini'),
  DUB_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high']).default('low'),
  DUB_STT_TIMEOUT_MS: ms(60_000),
  DUB_TRANSLATE_TIMEOUT_MS: ms(60_000),
  DUB_REFIT_TIMEOUT_MS: ms(30_000),
  SUPERTONIC_ASSETS_DIR: z.string().min(1).default('/opt/supertonic'),
  /** The CPU limit of the pod. */
  SUPERTONIC_THREADS: z.coerce.number().int().min(1).default(2),
  SUPERTONIC_STEPS: z.coerce.number().int().min(1).max(32).default(8),
  /** `fake` makes the whole track both voice and background, for tests, k6 and k3d. */
  DUB_AUDIO_SEPARATE: z.enum(['http', 'fake']).default('http'),
  AUDIO_SEPARATE_URL: z.url().default('http://audio-separate:8000'),
  /** For one call, waiting for a busy pod included. */
  AUDIO_SEPARATE_TIMEOUT_MS: ms(300_000),
});
export type DubEnv = z.infer<typeof dubEnvSchema>;

export interface DubProviders {
  stt: SpeechToText;
  translator: Translator;
  tts: TextToSpeech;
  audioSeparate: AudioSeparate;
}

/** Called once at start: a missing key or model stops the pod, not the first job. */
export async function createDubProviders(
  env: DubEnv,
  storage: Pick<DubStorage, 'copyObject' | 'putObject'>,
): Promise<DubProviders> {
  let stt: SpeechToText = new FakeSpeechToText();
  let translator: Translator = new FakeTranslator();
  if (env.DUB_PROVIDERS === 'openai') {
    if (!env.OPENAI_API_KEY)
      throw new Error('OPENAI_API_KEY is required with DUB_PROVIDERS=openai');
    const openAi = { apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL };
    stt = new OpenAiSpeechToText({ ...openAi, timeoutMs: env.DUB_STT_TIMEOUT_MS });
    translator = new OpenAiTranslator({
      ...openAi,
      model: env.DUB_TRANSLATE_MODEL,
      reasoningEffort: env.DUB_REASONING_EFFORT,
      translateTimeoutMs: env.DUB_TRANSLATE_TIMEOUT_MS,
      refitTimeoutMs: env.DUB_REFIT_TIMEOUT_MS,
    });
  }
  const tts =
    env.DUB_TTS === 'fake'
      ? new FakeTextToSpeech()
      : await Supertonic.load({
          assetsDir: env.SUPERTONIC_ASSETS_DIR,
          threads: env.SUPERTONIC_THREADS,
          steps: env.SUPERTONIC_STEPS,
        });
  const audioSeparate =
    env.DUB_AUDIO_SEPARATE === 'fake'
      ? new FakeAudioSeparate(storage)
      : new AudioSeparateClient({
          baseUrl: env.AUDIO_SEPARATE_URL,
          timeoutMs: env.AUDIO_SEPARATE_TIMEOUT_MS,
        });
  return { stt, translator, tts, audioSeparate };
}
