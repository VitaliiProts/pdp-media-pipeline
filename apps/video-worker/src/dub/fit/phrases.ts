import { type TranscriptSegment } from '../providers/types';

export interface Phrase {
  id: string;
  /** The recognised turn the phrase is a part of. */
  turn: string;
  speaker: string;
  start: number;
  end: number;
  text: string;
}

interface Word {
  word: string;
  start: number;
  end: number;
}

const SENTENCE_END = /[.!?;…]$/;
export const MIN_PAUSE_SECONDS = 0.35;

/**
 * Splits recognised turns into phrases with the timing of their own words: at sentence ends and
 * at pauses of `minPause` seconds or more. A single word is never left alone: it joins the next
 * phrase of the same turn, or the previous one at the end of the turn.
 */
export function toPhrases(
  segments: readonly TranscriptSegment[],
  aligned: readonly { id: string; words: readonly Word[] }[],
  minPause = MIN_PAUSE_SECONDS,
): Phrase[] {
  const wordsOf = new Map(aligned.map((s) => [s.id, s.words]));
  return segments.flatMap((segment): Phrase[] => {
    const words = wordsOf.get(segment.id) ?? [];
    const base = { turn: segment.id, speaker: segment.speaker };
    if (words.length === 0) {
      return [
        { id: segment.id, ...base, start: segment.start, end: segment.end, text: segment.text },
      ];
    }

    const pieces: Word[][] = [[]];
    words.forEach((word, i) => {
      pieces.at(-1)!.push(word);
      const next = words[i + 1];
      if (next && (SENTENCE_END.test(word.word) || next.start - word.end >= minPause)) {
        pieces.push([]);
      }
    });
    for (let i = 0; i < pieces.length && pieces.length > 1; i++) {
      if (pieces[i]!.length > 1) continue;
      const into = i + 1 < pieces.length ? i + 1 : i - 1;
      pieces[into] =
        into > i ? [...pieces[i]!, ...pieces[into]!] : [...pieces[into]!, ...pieces[i]!];
      pieces.splice(i, 1);
      i--;
    }

    return pieces.map((piece, k) => ({
      id: pieces.length === 1 ? segment.id : `${segment.id}.${k + 1}`,
      ...base,
      start: piece[0]!.start,
      end: piece.at(-1)!.end,
      text: piece.map((w) => w.word).join(' '),
    }));
  });
}
