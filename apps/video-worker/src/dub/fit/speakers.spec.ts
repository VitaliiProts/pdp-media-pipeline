import { assignVoices, listenerOf } from './speakers';

describe('listenerOf', () => {
  const phrases = [
    { speaker: 'A' },
    { speaker: 'A' },
    { speaker: 'B' },
    { speaker: 'A' },
    { speaker: 'C' },
  ];

  it('is the nearest other speaker, earlier first', () => {
    expect(listenerOf(phrases, 1)).toBe('B');
    expect(listenerOf(phrases, 3)).toBe('B');
    expect(listenerOf(phrases, 4)).toBe('A');
  });

  it('is nobody in a monologue', () => {
    expect(listenerOf([{ speaker: 'A' }, { speaker: 'A' }], 0)).toBeNull();
  });
});

describe('assignVoices', () => {
  it('gives voices of the gender in turn, the most speaking speaker first', () => {
    const voices = assignVoices([
      { id: 'A', gender: 'male', seconds: 5 },
      { id: 'B', gender: 'female', seconds: 8 },
      { id: 'C', gender: 'male', seconds: 12 },
    ]);
    expect(Object.fromEntries(voices)).toEqual({
      C: { gender: 'male', voice: 'M1' },
      B: { gender: 'female', voice: 'F1' },
      A: { gender: 'male', voice: 'M2' },
    });
  });

  it('starts over when a pool runs out', () => {
    const males = Array.from({ length: 6 }, (_, i) => ({
      id: `S${i}`,
      gender: 'male' as const,
      seconds: 10 - i,
    }));
    expect(assignVoices(males).get('S5')?.voice).toBe('M1');
  });

  it('takes a speaker of unknown gender from both pools', () => {
    const voices = assignVoices([
      { id: 'A', gender: 'male', seconds: 9 },
      { id: 'X', gender: 'unknown', seconds: 3 },
    ]);
    expect(voices.get('X')).toEqual({ gender: 'unknown', voice: 'F1' });
  });

  it('follows the corrections and keeps a chosen voice for its speaker alone', () => {
    const voices = assignVoices(
      [
        { id: 'A', gender: 'male', seconds: 9 },
        { id: 'B', gender: 'male', seconds: 4 },
        { id: 'C', gender: 'male', seconds: 2 },
      ],
      { B: { voice: 'M1' }, C: { gender: 'female' } },
    );
    expect(Object.fromEntries(voices)).toEqual({
      A: { gender: 'male', voice: 'M2' },
      B: { gender: 'male', voice: 'M1' },
      C: { gender: 'female', voice: 'F1' },
    });
  });

  it('takes the gender of a chosen voice', () => {
    const voices = assignVoices([{ id: 'A', gender: 'male', seconds: 9 }], { A: { voice: 'F3' } });
    expect(voices.get('A')).toEqual({ gender: 'female', voice: 'F3' });
  });
});
