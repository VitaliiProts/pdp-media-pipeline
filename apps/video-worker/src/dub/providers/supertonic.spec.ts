/**
 * @jest-environment ./native-arrays.environment.js
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Supertonic } from './supertonic';
import { chunkText, preprocessText } from './supertonic-engine';

const ASSETS =
  process.env.SUPERTONIC_ASSETS_DIR ?? join(__dirname, '../../../../../spikes/02-video-dub/assets');
const withModel = existsSync(join(ASSETS, 'onnx', 'tts.json')) ? describe : describe.skip;

describe('Supertonic text processing', () => {
  it('normalises dashes and quotes, ends with a stop and tags the language', () => {
    expect(preprocessText('Hello — “world”', 'en')).toBe('<en>Hello - "world"</en>');
    expect(preprocessText('Привіт ,  світе', 'uk')).toBe('<uk>Привіт, світе.</uk>');
  });

  it('rejects a language the model does not speak', () => {
    expect(() => preprocessText('Hi', 'xx')).toThrow('language');
  });

  it('splits long text at sentence ends', () => {
    const sentence = 'This is a sentence of some length. ';
    const chunks = chunkText(sentence.repeat(20), 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 100 && c.endsWith('.'))).toBe(true);
  });
});

withModel('Supertonic with the model', () => {
  let tts: Supertonic;
  beforeAll(async () => {
    tts = await Supertonic.load({ assetsDir: ASSETS, threads: 2, steps: 8 });
  }, 60_000);

  it.each([
    ['uk', 'Я так довго чекала на цей день, і ось він настав.'],
    ['de', 'Ich habe so lange auf diesen Tag gewartet, und jetzt ist er da.'],
  ] as const)(
    'predicts the length of the speech it synthesises in %s',
    async (language, text) => {
      const predicted = await tts.predict(text, language, 'F1');
      const spoken = (await tts.synthesize(text, language, 'F1', 1)).length / tts.sampleRate;
      expect(Math.abs(spoken - predicted)).toBeLessThan(0.5);
    },
    60_000,
  );

  it('speaks faster at a higher speed', async () => {
    const text = 'We should leave before the storm reaches the harbour.';
    const normal = (await tts.synthesize(text, 'en', 'M2', 1)).length;
    const fast = (await tts.synthesize(text, 'en', 'M2', 1.4)).length;
    expect(fast / normal).toBeGreaterThan(0.6);
    expect(fast / normal).toBeLessThan(0.85);
  }, 60_000);
});

describe('Supertonic without the model', () => {
  it('says where it looked for it', async () => {
    await expect(
      Supertonic.load({ assetsDir: '/nonexistent/supertonic', threads: 1, steps: 8 }),
    ).rejects.toThrow('/nonexistent/supertonic');
  });
});
