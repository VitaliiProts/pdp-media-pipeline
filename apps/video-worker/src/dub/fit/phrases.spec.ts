import { toPhrases } from './phrases';

const word = (w: string, start: number, end: number) => ({ word: w, start, end, score: 0.9 });
const turn = (id: string, text: string, start = 0, end = 10) => ({
  id,
  speaker: 'A',
  start,
  end,
  text,
});

describe('toPhrases', () => {
  it('cuts a turn at sentence ends and takes the times of its own words', () => {
    const phrases = toPhrases(
      [turn('1', 'Stop. Go home now.')],
      [
        {
          id: '1',
          words: [
            word('Stop.', 0.5, 0.9),
            word('Go', 1.0, 1.2),
            word('home', 1.25, 1.5),
            word('now.', 1.55, 1.9),
          ],
        },
      ],
    );
    // A single word is never left alone: "Stop." joins the next phrase.
    expect(phrases).toEqual([
      { id: '1', turn: '1', speaker: 'A', start: 0.5, end: 1.9, text: 'Stop. Go home now.' },
    ]);
  });

  it('cuts at a pause of 0.35 s and numbers the parts of the turn', () => {
    const phrases = toPhrases(
      [turn('3', 'I waited for you all night')],
      [
        {
          id: '3',
          words: [
            word('I', 0.2, 0.3),
            word('waited', 0.35, 0.7),
            word('for', 0.75, 0.9),
            word('you', 1.3, 1.5),
            word('all', 1.55, 1.7),
            word('night', 1.75, 2.1),
          ],
        },
      ],
    );
    expect(
      phrases.map(({ id, turn: t, start, end, text }) => ({ id, t, start, end, text })),
    ).toEqual([
      { id: '3.1', t: '3', start: 0.2, end: 0.9, text: 'I waited for' },
      { id: '3.2', t: '3', start: 1.3, end: 2.1, text: 'you all night' },
    ]);
  });

  it('joins a lone last word to the phrase before it', () => {
    const phrases = toPhrases(
      [turn('1', 'Come here. Now.')],
      [
        {
          id: '1',
          words: [word('Come', 0, 0.3), word('here.', 0.35, 0.7), word('Now.', 1.2, 1.4)],
        },
      ],
    );
    expect(phrases.map((p) => p.text)).toEqual(['Come here. Now.']);
  });

  it('keeps the recognised timing of a turn without aligned words', () => {
    expect(toPhrases([turn('7', '…', 4, 5)], [{ id: '7', words: [] }])).toEqual([
      { id: '7', turn: '7', speaker: 'A', start: 4, end: 5, text: '…' },
    ]);
  });
});
