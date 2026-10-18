import { type DubTargetLanguage, type DubVoice, voiceGender } from '@pdp/contracts';
import {
  type RefitRequest,
  type SpeechToText,
  type TextToSpeech,
  type TokenUsage,
  type Transcript,
  type TranscriptSegment,
  type TranslationRequest,
  type Translation,
  type Translator,
} from './types';

/**
 * Stand-ins without a key or a model, for tests, k6 and k3d: deterministic, offline, and
 * shaped like the real answers (several speakers, pauses, three lengths of a translation).
 */

const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

const SCRIPT = [
  'We should leave before the storm reaches the harbour.',
  'I told you this would happen, but nobody listened.',
  'Wait here and do not open the door for anyone.',
  'How long have you known about the second key?',
  'Long enough to stop trusting the people who made it.',
  'Then we go tonight, together, and we do not look back.',
];
const PHRASE_SECONDS = 2.5;
const PAUSE_SECONDS = 1;

/** Phrases of two speakers in turn, one every 3.5 s, as long as the audio has room. */
export class FakeSpeechToText implements SpeechToText {
  readonly name = 'fake-stt';

  constructor(private readonly segments?: TranscriptSegment[]) {}

  transcribe(audio: { path: string; durationSeconds: number }): Promise<Transcript> {
    if (this.segments) return Promise.resolve({ segments: this.segments, billedSeconds: 0 });
    const segments: TranscriptSegment[] = [];
    for (let start = 0.5; start + PHRASE_SECONDS <= audio.durationSeconds;) {
      const i = segments.length;
      segments.push({
        id: String(i + 1),
        start,
        end: start + PHRASE_SECONDS,
        text: SCRIPT[i % SCRIPT.length]!,
        speaker: i % 2 === 0 ? 'A' : 'B',
      });
      start += PHRASE_SECONDS + PAUSE_SECONDS;
    }
    return Promise.resolve({ segments, billedSeconds: 0 });
  }
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const firstWords = (text: string, count: number) => words(text).slice(0, count).join(' ');

/** Keeps the original words: the full line, then about two thirds and one third of it. */
export class FakeTranslator implements Translator {
  readonly name = 'fake-translator';

  translate(request: TranslationRequest): Promise<Translation> {
    return Promise.resolve({
      sourceLanguage: request.sourceLanguage === 'auto' ? 'en' : request.sourceLanguage,
      lines: request.lines.map(({ id, text }) => {
        const count = words(text).length;
        const variants = [
          text,
          firstWords(text, Math.ceil((count * 2) / 3)),
          firstWords(text, Math.ceil(count / 3)),
        ];
        return { id, variants: [...new Set(variants.filter(Boolean))] };
      }),
      usage: NO_USAGE,
    });
  }

  refit(request: RefitRequest): Promise<{ variants: string[]; usage: TokenUsage }> {
    const counts = [request.words - 1, request.words, request.words + 1].filter((n) => n > 0);
    const variants = [...new Set(counts.map((n) => firstWords(request.fullest, n)))];
    return Promise.resolve({ variants, usage: NO_USAGE });
  }
}

const CHARS_PER_SECOND = 15;
const MIN_SPEECH_SECONDS = 0.2;

/** A quiet tone as long as the text would take at 15 characters a second, lower for men. */
export class FakeTextToSpeech implements TextToSpeech {
  readonly name = 'fake-tts';
  readonly sampleRate = 24_000;

  predict(text: string, _language: DubTargetLanguage, _voice: DubVoice): Promise<number> {
    return Promise.resolve(Math.max(MIN_SPEECH_SECONDS, text.length / CHARS_PER_SECOND));
  }

  async synthesize(
    text: string,
    language: DubTargetLanguage,
    voice: DubVoice,
    speed: number,
  ): Promise<Float32Array> {
    const seconds = (await this.predict(text, language, voice)) / speed;
    const pitch = voiceGender(voice) === 'male' ? 140 : 230;
    return Float32Array.from(
      { length: Math.round(seconds * this.sampleRate) },
      (_, i) => 0.2 * Math.sin((2 * Math.PI * pitch * i) / this.sampleRate),
    );
  }
}
