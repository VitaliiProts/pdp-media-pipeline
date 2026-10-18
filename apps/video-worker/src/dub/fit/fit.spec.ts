import {
  charBudget,
  chooseVariant,
  fitError,
  fitStats,
  MAX_SPEED,
  needsRefit,
  placePhrases,
  refitWords,
  slotOf,
  speechOf,
} from './fit';

const phrases = [
  { start: 1, end: 3 },
  { start: 4, end: 5 },
  { start: 5.2, end: 8 },
];

describe('slots', () => {
  it('runs a slot to the next phrase or the end of the video', () => {
    expect([0, 1, 2].map((i) => slotOf(phrases, i, 10))).toEqual([3, 1.2000000000000002, 4.8]);
  });

  it('takes the speech of a phrase, cut by its slot', () => {
    expect(speechOf(phrases, 0, 10)).toBe(2);
    expect(
      speechOf(
        [
          { start: 0, end: 3 },
          { start: 2, end: 4 },
        ],
        0,
        10,
      ),
    ).toBe(2);
  });

  it('gives the translator at least a few characters', () => {
    expect(charBudget(2, 15)).toBe(30);
    expect(charBudget(0.2, 15)).toBe(8);
  });
});

describe('chooseVariant', () => {
  it('takes the phrasing that ends with the original at speed 1', () => {
    expect(chooseVariant([3.1, 2.0, 1.2], 2, 3)).toBe(1);
  });

  it('prefers the fuller phrasing when the shorter one fits only slightly better', () => {
    expect(chooseVariant([2.1, 1.95], 2, 3)).toBe(0);
  });

  it('avoids a phrasing that would need an audible speed-up', () => {
    expect(chooseVariant([2.7, 2.1], 2, 3)).toBe(1);
  });

  it('takes the least overflowing phrasing when none fits its slot', () => {
    expect(chooseVariant([9, 6, 7], 2, 2)).toBe(1);
  });
});

describe('fitError', () => {
  it('is how far the end is off after the speed change', () => {
    expect(fitError(2.4, 2, 3)).toBeCloseTo(0, 5);
    expect(fitError(1.5, 2, 3)).toBeCloseTo(2 - 1.5 / 0.9, 5);
  });

  it('is the overflow of the slot when even the top speed is not enough', () => {
    expect(fitError(5.6, 2, 3)).toBeCloseTo(5.6 / MAX_SPEED - 3, 5);
  });

  it('asks for a refit above half a second', () => {
    expect(needsRefit(2.4, 2, 3)).toBe(false);
    expect(needsRefit(5.6, 2, 3)).toBe(true);
  });
});

describe('refitWords', () => {
  it('scales the words of the fullest phrasing to the time there is', () => {
    // 10 words in 4 s is 2.5 words a second; the original speaks 2 s.
    expect(refitWords(10, 4, 2, 3)).toBe(5);
  });

  it('allows a little more than the slot when the speech runs to its end', () => {
    expect(refitWords(10, 4, 2, 1.6)).toBe(5);
    expect(refitWords(10, 4, 2, 1)).toBe(3);
  });

  it('asks for at least one word', () => {
    expect(refitWords(1, 3, 0.1, 0.1)).toBe(1);
  });
});

describe('placePhrases', () => {
  it('starts with the original and speeds up to end with it', () => {
    const [first] = placePhrases([{ start: 1, end: 3 }], [2.4], 10);
    expect(first).toMatchObject({ placedStart: 1, speed: 1.2 });
    expect(first!.placedEnd).toBeCloseTo(3, 5);
    expect(first!.overflow).toBe(0);
  });

  it('slows down no more than to 0.9', () => {
    const [first] = placePhrases([{ start: 0, end: 2 }], [1], 10);
    expect(first!.speed).toBe(0.9);
  });

  it('runs into the pause at the top speed and pushes the next phrase back', () => {
    const [first, second] = placePhrases(
      [
        { start: 0, end: 1 },
        { start: 1.5, end: 2.5 },
      ],
      [2.8, 1],
      10,
    );
    expect(first!.speed).toBe(MAX_SPEED);
    expect(first!.placedEnd).toBeCloseTo(2, 5);
    expect(first!.overflow).toBeCloseTo(0.5, 5);
    expect(second!.placedStart).toBeCloseTo(2.08, 5);
  });
});

describe('fitStats', () => {
  it('counts sped, refitted and overflowing phrases and the mean end error', () => {
    const timed = [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ];
    const placed = [
      { placedStart: 0, placedEnd: 1.2, speed: 1.3, overflow: 0 },
      { placedStart: 2, placedEnd: 3, speed: 1, overflow: 0.2 },
    ];
    expect(fitStats(timed, placed, [true, false])).toEqual({
      phrases: 2,
      sped: 1,
      refitted: 1,
      overflowed: 1,
      meanEndErrorSeconds: 0.1,
    });
  });

  it('has no error without phrases', () => {
    expect(fitStats([], [], []).meanEndErrorSeconds).toBe(0);
  });
});
