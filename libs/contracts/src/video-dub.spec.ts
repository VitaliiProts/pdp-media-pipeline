import {
  dubCheckpointKey,
  dubSubtitlesKey,
  dubVideoKey,
  VideoDubInputV1,
  VideoDubOutputV1,
} from './video-dub';

const JOB_ID = '7f1c3a52-0d7e-4b43-9a55-2f6f0e3c9b10';

describe('VideoDubInputV1', () => {
  it('detects the source language unless told', () => {
    expect(VideoDubInputV1.parse({ sourceKey: 'uploads/a.mp4', targetLanguage: 'uk' })).toEqual({
      sourceKey: 'uploads/a.mp4',
      targetLanguage: 'uk',
      sourceLanguage: 'auto',
    });
  });

  it.each(['uk', 'de', 'en', 'es', 'fr'])('dubs into %s', (targetLanguage) => {
    expect(VideoDubInputV1.safeParse({ sourceKey: 'k', targetLanguage }).success).toBe(true);
  });

  it('rejects a dub language without voices', () => {
    expect(VideoDubInputV1.safeParse({ sourceKey: 'k', targetLanguage: 'ru' }).success).toBe(false);
  });

  it('takes the source only from the media library', () => {
    const input = { sourceUrl: 'https://example.com/a.mp4', targetLanguage: 'de' };
    expect(VideoDubInputV1.safeParse(input).success).toBe(false);
  });

  it('accepts a two-letter source language', () => {
    const input = { sourceKey: 'k', targetLanguage: 'de', sourceLanguage: 'pl' };
    expect(VideoDubInputV1.parse(input).sourceLanguage).toBe('pl');
  });

  it.each(['english', 'EN', 'e'])('rejects source language %s', (sourceLanguage) => {
    const input = { sourceKey: 'k', targetLanguage: 'de', sourceLanguage };
    expect(VideoDubInputV1.safeParse(input).success).toBe(false);
  });

  it('rejects a source language that is already the dub language', () => {
    const input = { sourceKey: 'k', targetLanguage: 'de', sourceLanguage: 'de' };
    expect(VideoDubInputV1.safeParse(input).success).toBe(false);
  });

  it('takes corrected speakers and the dub they correct', () => {
    const input = {
      sourceKey: 'k',
      targetLanguage: 'uk',
      speakers: { A: { gender: 'female', voice: 'F3' }, B: { voice: 'M5' }, C: { gender: 'male' } },
      reuseOf: JOB_ID,
    };
    expect(VideoDubInputV1.parse(input)).toMatchObject(input);
  });

  it.each(['M6', 'X1', 'm1'])('rejects voice %s', (voice) => {
    const input = { sourceKey: 'k', targetLanguage: 'uk', speakers: { A: { voice } } };
    expect(VideoDubInputV1.safeParse(input).success).toBe(false);
  });

  it('rejects a voice of the other gender than the one given', () => {
    const input = {
      sourceKey: 'k',
      targetLanguage: 'uk',
      speakers: { A: { gender: 'female', voice: 'M1' } },
    };
    expect(VideoDubInputV1.safeParse(input).success).toBe(false);
  });

  it('rejects a previous dub that is not a job id', () => {
    const input = { sourceKey: 'k', targetLanguage: 'uk', reuseOf: 'last-one' };
    expect(VideoDubInputV1.safeParse(input).success).toBe(false);
  });
});

describe('VideoDubOutputV1', () => {
  const output = {
    durationSeconds: 30,
    sourceLanguage: 'en',
    targetLanguage: 'uk',
    video: { key: dubVideoKey(JOB_ID), bytes: 4_200_000 },
    subtitles: { key: dubSubtitlesKey(JOB_ID) },
    speakers: [
      { id: 'A', gender: 'male', maleProbability: 0.63, voice: 'M1', seconds: 13.5 },
      { id: 'B', gender: 'female', maleProbability: 0.001, voice: 'F1', seconds: 6.5 },
    ],
    phrases: [
      {
        id: '1.1',
        turn: '1',
        speaker: 'A',
        start: 9.49,
        end: 12.01,
        source: 'Look Celia, we have to follow our passions.',
        target: 'Селія, ми маємо слідувати нашим пристрастям.',
        placedStart: 9.49,
        placedEnd: 12.02,
        speed: 1.11,
        refitted: false,
      },
    ],
    unrecognized: [{ start: 8.28, end: 9.49 }],
    stats: { phrases: 1, sped: 1, refitted: 0, overflowed: 0, meanEndErrorSeconds: 0.01 },
    usage: { audioSeconds: 30, inputTokens: 1245, outputTokens: 1955, estimatedCostUsd: 0.0121 },
  };

  it('describes the dub, its speakers and every phrase', () => {
    expect(VideoDubOutputV1.parse(output)).toEqual(output);
  });

  it('rejects a phrase that ends before it starts', () => {
    const phrase = { ...output.phrases[0], start: 12, end: 9 };
    expect(VideoDubOutputV1.safeParse({ ...output, phrases: [phrase] }).success).toBe(false);
  });
});

describe('dub keys', () => {
  it('keeps every artifact of a dub under the job prefix', () => {
    expect(dubVideoKey(JOB_ID)).toBe(`results/${JOB_ID}/dubbed.mp4`);
    expect(dubSubtitlesKey(JOB_ID)).toBe(`results/${JOB_ID}/dubbed.vtt`);
    expect(dubCheckpointKey(JOB_ID, 'transcript.json')).toBe(
      `results/${JOB_ID}/dub/transcript.json`,
    );
  });
});
