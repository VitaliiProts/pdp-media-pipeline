const SENTENCE_END = /[.!?;…]$/;

/**
 * Splits recognised turns into phrases with the timing of their own words: at sentence ends and
 * at pauses of `minGap` seconds or more. A single word is never left alone, it joins the next
 * phrase of the same turn (or the previous one at the end of the turn).
 */
export function toPhrases(segments, aligned, { minGap = 0.35 } = {}) {
  const wordsOf = new Map(aligned.segments.map((s) => [s.id, s.words]));
  return segments.flatMap((segment) => {
    const words = wordsOf.get(segment.id);
    if (!words?.length) return [segment];
    const pieces = [[]];
    words.forEach((word, i) => {
      pieces.at(-1).push(word);
      const next = words[i + 1];
      if (next && (SENTENCE_END.test(word.word) || next.start - word.end >= minGap)) {
        pieces.push([]);
      }
    });
    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i].length > 1 || pieces.length === 1) continue;
      const into = i + 1 < pieces.length ? i + 1 : i - 1;
      pieces[into] = into > i ? [...pieces[i], ...pieces[into]] : [...pieces[into], ...pieces[i]];
      pieces.splice(i, 1);
      i--;
    }
    return pieces.map((piece, k) => ({
      id: pieces.length === 1 ? segment.id : `${segment.id}.${k + 1}`,
      turn: segment.id,
      speaker: segment.speaker,
      start: piece[0].start,
      end: piece.at(-1).end,
      text: piece.map((w) => w.word).join(' '),
    }));
  });
}
