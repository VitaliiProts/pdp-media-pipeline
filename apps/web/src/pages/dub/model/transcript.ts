import { type AssetDub } from '../../../features/assets';

/** Thresholds of the worker's `fitStats`, so the marks add up to the stats it reports. */
const SPED_ABOVE = 1.01;
const OVERFLOW_ABOVE_S = 0.01;

export type PhraseMark = 'sped' | 'refitted' | 'overflowed';

export type TranscriptRow =
  | {
      kind: 'phrase';
      id: string;
      start: number;
      /** Until the original or the dubbed phrase stops, whichever is later. */
      until: number;
      speaker: string;
      source: string;
      target: string;
      speed: number;
      marks: PhraseMark[];
    }
  | { kind: 'unrecognized'; id: string; start: number; until: number };

/** Phrases and the voice no word covers, in the order they are heard. */
export function transcriptOf(dub: AssetDub): TranscriptRow[] {
  const phrases = dub.phrases.map((phrase, i): TranscriptRow => {
    // Like the worker: spoken past the next original start, or the end of the video.
    const slotEnd = dub.phrases[i + 1]?.start ?? dub.durationSeconds;
    const marks: PhraseMark[] = [];
    if (phrase.speed > SPED_ABOVE) marks.push('sped');
    if (phrase.refitted) marks.push('refitted');
    if (phrase.placedEnd - slotEnd > OVERFLOW_ABOVE_S) marks.push('overflowed');
    return {
      kind: 'phrase',
      id: phrase.id,
      start: phrase.start,
      until: Math.max(phrase.end, phrase.placedEnd),
      speaker: phrase.speaker,
      source: phrase.source,
      target: phrase.target,
      speed: phrase.speed,
      marks,
    };
  });
  const gaps = dub.unrecognized.map(({ start, end }, i): TranscriptRow => ({
    kind: 'unrecognized',
    id: `gap-${i}`,
    start,
    until: end,
  }));
  return [...phrases, ...gaps].sort((a, b) => a.start - b.start);
}

/** The row being heard at `seconds`: the latest one started that has not finished. */
export function currentRowId(rows: readonly TranscriptRow[], seconds: number): string | null {
  let current: string | null = null;
  for (const row of rows) {
    if (row.start > seconds) break;
    if (seconds < row.until) current = row.id;
  }
  return current;
}
