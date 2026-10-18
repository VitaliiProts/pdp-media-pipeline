import { FakeSpeechToText, FakeTextToSpeech, FakeTranslator } from './fake';
import { type TranslationLine } from './types';

const line = (id: string, text: string): TranslationLine => ({
  id,
  turn: id,
  speaker: 'A',
  speakerGender: 'unknown',
  listenerGender: 'unknown',
  text,
  seconds: 2,
  maxChars: 30,
});

describe('FakeSpeechToText', () => {
  it('speaks in turns of two speakers with pauses, within the audio', async () => {
    const { segments, billedSeconds } = await new FakeSpeechToText().transcribe({
      path: 'unused',
      durationSeconds: 20,
    });

    expect(segments.length).toBeGreaterThanOrEqual(4);
    expect(new Set(segments.map((s) => s.speaker))).toEqual(new Set(['A', 'B']));
    expect(segments.every((s) => s.start >= 0 && s.end <= 20 && s.end > s.start && s.text)).toBe(
      true,
    );
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.start).toBeGreaterThan(segments[i - 1]!.end);
    }
    expect(billedSeconds).toBe(0);
  });

  it('hears nothing in audio too short for a phrase', async () => {
    const { segments } = await new FakeSpeechToText().transcribe({
      path: 'x',
      durationSeconds: 0.8,
    });
    expect(segments).toEqual([]);
  });

  it('returns the segments it was given', async () => {
    const given = [{ id: '1', start: 1, end: 2, text: 'Hi.', speaker: 'X' }];
    await expect(
      new FakeSpeechToText(given).transcribe({ path: 'x', durationSeconds: 5 }),
    ).resolves.toMatchObject({ segments: given });
  });
});

describe('FakeTranslator', () => {
  const translator = new FakeTranslator();

  it('phrases every line from the fullest to the shortest', async () => {
    const result = await translator.translate({
      targetLanguage: 'de',
      sourceLanguage: 'auto',
      lines: [line('1', 'We should leave before the storm reaches us.'), line('2', 'Go.')],
    });

    expect(result.sourceLanguage).toBe('en');
    expect(result.lines.map((l) => l.id)).toEqual(['1', '2']);
    const [full, ...shorter] = result.lines[0]!.variants;
    expect(full).toBe('We should leave before the storm reaches us.');
    expect(shorter.every((v) => v.length < full!.length)).toBe(true);
    expect(result.lines[1]!.variants).toEqual(['Go.']);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('keeps a given source language', async () => {
    const result = await translator.translate({
      targetLanguage: 'en',
      sourceLanguage: 'uk',
      lines: [],
    });
    expect(result.sourceLanguage).toBe('uk');
  });

  it('refits around the asked number of words', async () => {
    const { variants } = await translator.refit({
      targetLanguage: 'de',
      original: 'one two three four five six',
      fullest: 'one two three four five six',
      words: 3,
      before: null,
      after: null,
      speakerGender: 'unknown',
      listenerGender: 'unknown',
    });
    expect(variants).toEqual(['one two', 'one two three', 'one two three four']);
  });
});

describe('FakeTextToSpeech', () => {
  const tts = new FakeTextToSpeech();

  it('speaks longer text longer and synthesises what it predicts', async () => {
    const short = await tts.predict('Hallo.', 'de', 'F1');
    const long = await tts.predict('Hallo, wie geht es dir heute Abend?', 'de', 'F1');
    expect(long).toBeGreaterThan(short);

    const wav = await tts.synthesize('Hallo, wie geht es dir heute Abend?', 'de', 'M1', 1.25);
    expect(wav.length / tts.sampleRate).toBeCloseTo(long / 1.25, 2);
    expect(Math.max(...wav)).toBeGreaterThan(0);
  });
});
