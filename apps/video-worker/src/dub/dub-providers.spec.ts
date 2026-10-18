import { AudioSeparateClient } from './audio-separate/audio-separate.client';
import { FakeAudioSeparate } from './audio-separate/fake-audio-separate';
import { createDubProviders, type DubEnv, dubEnvSchema } from './dub-providers';
import { FakeSpeechToText, FakeTextToSpeech, FakeTranslator } from './providers/fake';
import { OpenAiSpeechToText, OpenAiTranslator } from './providers/openai';

const env = (overrides: Record<string, string> = {}): DubEnv => dubEnvSchema.parse(overrides);

describe('dub settings', () => {
  it('defaults to OpenAI, Supertonic and the timeouts of ADR-016', () => {
    expect(env()).toMatchObject({
      DUB_PROVIDERS: 'openai',
      DUB_TTS: 'supertonic',
      DUB_TRANSLATE_MODEL: 'gpt-5-mini',
      DUB_REASONING_EFFORT: 'low',
      DUB_STT_TIMEOUT_MS: 60_000,
      DUB_TRANSLATE_TIMEOUT_MS: 60_000,
      DUB_REFIT_TIMEOUT_MS: 30_000,
      AUDIO_SEPARATE_TIMEOUT_MS: 300_000,
    });
  });
});

const storage = {
  copyObject: () => Promise.resolve(),
  putObject: () => Promise.resolve(),
};

describe('createDubProviders', () => {
  it('runs without a key or a model on fakes', async () => {
    const providers = await createDubProviders(
      env({ DUB_PROVIDERS: 'fake', DUB_TTS: 'fake' }),
      storage,
    );
    expect(providers.stt).toBeInstanceOf(FakeSpeechToText);
    expect(providers.translator).toBeInstanceOf(FakeTranslator);
    expect(providers.tts).toBeInstanceOf(FakeTextToSpeech);
    expect(providers.audioSeparate).toBeInstanceOf(AudioSeparateClient);
  });

  it('stands in for audio-separate when told to', async () => {
    const providers = await createDubProviders(
      env({ DUB_PROVIDERS: 'fake', DUB_TTS: 'fake', DUB_AUDIO_SEPARATE: 'fake' }),
      storage,
    );
    expect(providers.audioSeparate).toBeInstanceOf(FakeAudioSeparate);
  });

  it('refuses to start on OpenAI without a key', async () => {
    await expect(createDubProviders(env({ DUB_TTS: 'fake' }), storage)).rejects.toThrow(
      'OPENAI_API_KEY',
    );
  });

  it('uses OpenAI with a key', async () => {
    const providers = await createDubProviders(
      env({ DUB_TTS: 'fake', OPENAI_API_KEY: 'sk-test' }),
      storage,
    );
    expect(providers.stt).toBeInstanceOf(OpenAiSpeechToText);
    expect(providers.translator).toBeInstanceOf(OpenAiTranslator);
  });

  it('fails at start when the Supertonic model is missing', async () => {
    await expect(
      createDubProviders(
        env({ DUB_PROVIDERS: 'fake', SUPERTONIC_ASSETS_DIR: '/nonexistent' }),
        storage,
      ),
    ).rejects.toThrow('/nonexistent');
  });
});
