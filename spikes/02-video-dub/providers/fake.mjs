import { clipCues, readSrt } from '../lib/srt.mjs';

/**
 * Recognition from the film's English subtitles, with speakers labelled by hand. Subtitle
 * timing is padded compared to speech, which is close enough to exercise the timeline.
 */
export function fakeStt({ srt, offset, duration, speakers }) {
  return {
    name: 'fake (English subtitles)',
    async transcribe() {
      const segments = clipCues(readSrt(srt), offset, duration).map((c) => ({
        id: String(c.id),
        start: c.start,
        end: c.end,
        text: c.text,
        speaker: speakers[c.id] ?? 'A',
      }));
      return { segments, billedSeconds: 0 };
    },
  };
}

/**
 * The film's German subtitles: a human translation written for reading, not for dubbing, so it
 * runs longer than the speech. It cannot shorten a line on request.
 */
export function fakeTranslator({ srt }) {
  const german = new Map(readSrt(srt).map((c) => [String(c.id), c.text]));
  return {
    name: 'fake (German subtitles)',
    async translate(segments) {
      return {
        sourceLanguage: 'en',
        segments: segments.map((s) => ({ id: s.id, text: german.get(s.id) ?? s.text })),
        usage: null,
      };
    },
    async shorten() {
      return null;
    },
  };
}
