import { type DubTargetLanguage, type DubVoice, type SpeakerGender } from '@pdp/contracts';

/** Unknown when the classifier gave no answer for a speaker or nobody else speaks. */
export type GenderHint = SpeakerGender | 'unknown';

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  /** A label of the recogniser, stable within one transcript only. */
  speaker: string;
}

export interface Transcript {
  segments: TranscriptSegment[];
  /** What the provider charges for. */
  billedSeconds: number;
}

/**
 * Segments with speakers, whoever labels them: the diarizing model is shut down on
 * 26 February 2027, and a successor may need a separate diarization step behind this.
 */
export interface SpeechToText {
  readonly name: string;
  transcribe(
    audio: { path: string; durationSeconds: number },
    signal?: AbortSignal,
  ): Promise<Transcript>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TranslationLine {
  id: string;
  /** Lines of one turn are consecutive parts of one utterance. */
  turn: string;
  speaker: string;
  speakerGender: GenderHint;
  listenerGender: GenderHint;
  text: string;
  /** Time the original speaker took for the line. */
  seconds: number;
  /** Rough limit from the speech rate of the chosen voice. */
  maxChars: number;
}

export interface TranslationRequest {
  targetLanguage: DubTargetLanguage;
  /** ISO 639-1, or `auto` to have it detected. */
  sourceLanguage: string;
  lines: TranslationLine[];
}

export interface Translation {
  /** ISO 639-1 of the original speech, as given or detected. */
  sourceLanguage: string;
  /** Every requested line once; variants from the fullest to the shortest. */
  lines: { id: string; variants: string[] }[];
  usage: TokenUsage;
}

export interface RefitRequest {
  targetLanguage: DubTargetLanguage;
  original: string;
  /** The fullest translation, to be rephrased. */
  fullest: string;
  words: number;
  /** Neighbouring parts of the same turn, to agree with. */
  before: string | null;
  after: string | null;
  speakerGender: GenderHint;
  listenerGender: GenderHint;
}

export interface Translator {
  readonly name: string;
  translate(request: TranslationRequest, signal?: AbortSignal): Promise<Translation>;
  /** Phrasings of about `words` words: a little shorter, about that, a little longer. */
  refit(
    request: RefitRequest,
    signal?: AbortSignal,
  ): Promise<{ variants: string[]; usage: TokenUsage }>;
}

/** Both methods work with the spoken part only, without the silence around it. */
export interface TextToSpeech {
  readonly name: string;
  readonly sampleRate: number;
  /** Seconds of speech at speed 1, without synthesising. */
  predict(text: string, language: DubTargetLanguage, voice: DubVoice): Promise<number>;
  /** Mono samples in -1..1; `speed` above 1 is faster. */
  synthesize(
    text: string,
    language: DubTargetLanguage,
    voice: DubVoice,
    speed: number,
  ): Promise<Float32Array>;
}
