/** Mirrors `DUB_TARGET_LANGUAGES` in @pdp/contracts: what every voice speaks. */
export const DUB_TARGET_LANGUAGES = ['uk', 'de', 'en', 'es', 'fr'] as const;
export type DubTargetLanguage = (typeof DUB_TARGET_LANGUAGES)[number];

/** Recognition takes any language; these are offered when detection should not guess. */
export const DUB_SOURCE_LANGUAGES = [
  'en',
  'uk',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'pl',
  'nl',
  'tr',
  'ja',
  'ko',
  'zh',
] as const;

export const AUTO_LANGUAGE = 'auto';

export type DubSettings = {
  targetLanguage: DubTargetLanguage;
  /** ISO 639-1, or `auto` to detect it. */
  sourceLanguage: string;
};

export const DEFAULT_DUB_SETTINGS: DubSettings = {
  targetLanguage: 'uk',
  sourceLanguage: AUTO_LANGUAGE,
};

/** The gateway refuses a dub into the language the video is said to be in. */
export const isSameLanguage = ({ sourceLanguage, targetLanguage }: DubSettings): boolean =>
  sourceLanguage === targetLanguage;

export type DubVoice = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5';
export type SpeakerGender = 'male' | 'female';

/** Corrections of a previous dub's speakers, by speaker id. */
export type SpeakerOverrides = Record<string, { gender?: SpeakerGender; voice?: DubVoice }>;

export type StartDubArgs = DubSettings & {
  assetId: string;
  sourceKey: string;
  speakers?: SpeakerOverrides;
  /** A previous dub of the same file, whose recognition is reused. */
  reuseOf?: string;
};

export type DubQuota = {
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  maxVideoSeconds: number;
  resetsAt: string;
};

/** Why a video cannot be dubbed now, judged before anything is sent. */
export type DubBlock = 'tooLong' | 'overQuota';

/**
 * The quota holds what the library knows of the duration; a file it has not measured yet (a
 * new upload, too) holds the longest a dub may be until the worker measures it.
 */
export function dubBlockOf(
  durationSeconds: number | null,
  quota: DubQuota,
  { measured }: { measured: boolean },
): DubBlock | null {
  if (durationSeconds !== null && durationSeconds > quota.maxVideoSeconds) return 'tooLong';
  const held =
    measured && durationSeconds !== null ? Math.ceil(durationSeconds) : quota.maxVideoSeconds;
  return held > quota.remainingSeconds ? 'overQuota' : null;
}

/** New uploads in order, each holding a full dub of what the ones before it left. */
export function uploadDubBlocksOf(
  durations: readonly (number | null)[],
  quota: DubQuota,
): (DubBlock | null)[] {
  let remainingSeconds = quota.remainingSeconds;
  return durations.map((seconds) => {
    const block = dubBlockOf(seconds, { ...quota, remainingSeconds }, { measured: false });
    if (!block) remainingSeconds -= quota.maxVideoSeconds;
    return block;
  });
}
