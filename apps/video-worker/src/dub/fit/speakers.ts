import { DUB_VOICES, type DubVoice, type SpeakerGender, voiceGender } from '@pdp/contracts';
import { type GenderHint } from '../providers/types';

/** Whom a phrase most likely addresses: the nearest phrase of another speaker, earlier first. */
export function listenerOf(phrases: readonly { speaker: string }[], i: number): string | null {
  const own = phrases[i]!.speaker;
  for (let d = 1; d < phrases.length; d++) {
    for (const j of [i - d, i + d]) {
      const other = phrases[j]?.speaker;
      if (other !== undefined && other !== own) return other;
    }
  }
  return null;
}

const MALE = DUB_VOICES.filter((v) => voiceGender(v) === 'male');
const FEMALE = DUB_VOICES.filter((v) => voiceGender(v) === 'female');
/** Alternating, so speakers of unknown gender are told apart by gender as well. */
const ANY = MALE.flatMap((m, i) => [m, FEMALE[i]!]);
const POOLS: Record<GenderHint, readonly DubVoice[]> = { male: MALE, female: FEMALE, unknown: ANY };

export interface SpeakerOverride {
  gender?: SpeakerGender;
  voice?: DubVoice;
}

/**
 * A voice per speaker from the pool of their gender, in turn by how long they speak; a pool
 * that runs out starts over. Corrections win, and a voice chosen for one speaker is not given
 * to another while the pool has a free one.
 */
export function assignVoices(
  speakers: readonly { id: string; gender: GenderHint; seconds: number }[],
  overrides: Record<string, SpeakerOverride> = {},
): Map<string, { gender: GenderHint; voice: DubVoice }> {
  const result = new Map<string, { gender: GenderHint; voice: DubVoice }>();
  const used = new Set<DubVoice>();
  for (const { id } of speakers) {
    const voice = overrides[id]?.voice;
    if (!voice) continue;
    result.set(id, { gender: overrides[id]?.gender ?? voiceGender(voice), voice });
    used.add(voice);
  }

  const turns: Record<GenderHint, number> = { male: 0, female: 0, unknown: 0 };
  for (const speaker of [...speakers].sort((a, b) => b.seconds - a.seconds)) {
    if (result.has(speaker.id)) continue;
    const gender = overrides[speaker.id]?.gender ?? speaker.gender;
    const pool = POOLS[gender];
    const voice = pool.find((v) => !used.has(v)) ?? pool[turns[gender] % pool.length]!;
    turns[gender]++;
    used.add(voice);
    result.set(speaker.id, { gender, voice });
  }
  return new Map(speakers.map(({ id }) => [id, result.get(id)!]));
}
