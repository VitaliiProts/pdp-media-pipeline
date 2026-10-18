import { z } from 'zod';

/** The dub's audio goes to speech recognition in one request (ADR-016). */
export const DUB_MAX_DURATION_SECONDS = 60;

/** Reported as the progress step, in this order; speech recognition runs during `separate`. */
export const DUB_STEPS = ['extract', 'separate', 'align', 'translate', 'voice', 'mix'] as const;
export type DubStep = (typeof DUB_STEPS)[number];

/** Languages every voice of the synthesiser speaks and the pipeline was checked in. */
export const DUB_TARGET_LANGUAGES = ['uk', 'de', 'en', 'es', 'fr'] as const;
export const DubTargetLanguageSchema = z.enum(DUB_TARGET_LANGUAGES);
export type DubTargetLanguage = z.infer<typeof DubTargetLanguageSchema>;

export const DUB_VOICES = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'] as const;
export const DubVoiceSchema = z.enum(DUB_VOICES);
export type DubVoice = z.infer<typeof DubVoiceSchema>;

export const SpeakerGenderSchema = z.enum(['male', 'female']);
export type SpeakerGender = z.infer<typeof SpeakerGenderSchema>;

export const voiceGender = (voice: DubVoice): SpeakerGender =>
  voice.startsWith('M') ? 'male' : 'female';

/** ISO 639-1. */
const LanguageCodeSchema = z.string().regex(/^[a-z]{2}$/, 'a two-letter ISO 639-1 code');

const SpeakerOverrideSchema = z
  .object({ gender: SpeakerGenderSchema.optional(), voice: DubVoiceSchema.optional() })
  .refine(
    (s) => !s.gender || !s.voice || voiceGender(s.voice) === s.gender,
    'voice must be of the given gender',
  );

export const VideoDubInputV1 = z
  .object({
    /** Only the media library: the dub quota counts the duration of a known asset. */
    sourceKey: z.string().min(1),
    targetLanguage: DubTargetLanguageSchema,
    sourceLanguage: z.union([z.literal('auto'), LanguageCodeSchema]).default('auto'),
    /** Corrections of what the pipeline found, by speaker id of a previous dub. */
    speakers: z.record(z.string().min(1), SpeakerOverrideSchema).optional(),
    /** A previous dub of the same asset: its recognition and audio analysis are reused. */
    reuseOf: z.uuid().optional(),
  })
  .refine((input) => input.sourceLanguage !== input.targetLanguage, {
    message: 'the source is already in the dub language',
    path: ['sourceLanguage'],
  });
export type VideoDubInputV1 = z.infer<typeof VideoDubInputV1>;

const seconds = z.number().min(0);

const DubSpeakerSchema = z.object({
  id: z.string(),
  gender: SpeakerGenderSchema,
  maleProbability: z.number().min(0).max(1),
  voice: DubVoiceSchema,
  seconds,
});

const DubPhraseSchema = z
  .object({
    id: z.string(),
    /** Phrases of one turn are parts of one utterance of one speaker. */
    turn: z.string(),
    speaker: z.string(),
    start: seconds,
    end: seconds,
    source: z.string(),
    target: z.string(),
    placedStart: seconds,
    placedEnd: seconds,
    speed: z.number().positive(),
    /** Rewritten to a word count because no variant fitted its time. */
    refitted: z.boolean(),
  })
  .refine((p) => p.end >= p.start && p.placedEnd >= p.placedStart, 'a phrase ends after it starts');

export const VideoDubOutputV1 = z.object({
  durationSeconds: z.number().positive(),
  sourceLanguage: LanguageCodeSchema,
  targetLanguage: DubTargetLanguageSchema,
  video: z.object({ key: z.string(), bytes: z.number().int().positive() }),
  subtitles: z.object({ key: z.string() }),
  speakers: z.array(DubSpeakerSchema),
  phrases: z.array(DubPhraseSchema),
  /** Voice in the separated track that no recognised word covers: shown, never dubbed. */
  unrecognized: z.array(z.object({ start: seconds, end: seconds })),
  stats: z.object({
    phrases: z.number().int().min(0),
    sped: z.number().int().min(0),
    refitted: z.number().int().min(0),
    /** Ran past their slot even at the highest speed. */
    overflowed: z.number().int().min(0),
    meanEndErrorSeconds: seconds,
  }),
  /** What the providers billed, for the cost estimate. */
  usage: z.object({
    audioSeconds: seconds,
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    estimatedCostUsd: z.number().min(0),
  }),
});
export type VideoDubOutputV1 = z.infer<typeof VideoDubOutputV1>;

/** Dub seconds of a user in the current calendar month (UTC), as the create check counts them. */
export const DubQuotaDto = z.object({
  usedSeconds: z.number().int().min(0),
  limitSeconds: z.number().int().min(0),
  /** Start of the next month, when the count starts over. */
  resetsAt: z.iso.datetime(),
});
export type DubQuotaDto = z.infer<typeof DubQuotaDto>;

/** Deterministic, so a redelivered job overwrites instead of duplicating. */
export const dubVideoKey = (jobId: string): string => `results/${jobId}/dubbed.mp4`;

export const dubSubtitlesKey = (jobId: string): string => `results/${jobId}/dubbed.vtt`;

/** Intermediate artifacts; a retry that finds one skips its step and does not pay again. */
export const dubCheckpointKey = (jobId: string, name: string): string =>
  `results/${jobId}/dub/${name}`;
