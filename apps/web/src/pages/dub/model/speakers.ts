import { type AssetDubSpeaker } from '../../../features/assets';
import { type DubVoice, type SpeakerGender, type SpeakerOverrides } from '../../../features/upload';

/** Mirrors `DUB_VOICES` in @pdp/contracts: M voices are male, F voices female. */
export const VOICES = {
  male: ['M1', 'M2', 'M3', 'M4', 'M5'],
  female: ['F1', 'F2', 'F3', 'F4', 'F5'],
} as const satisfies Record<SpeakerGender, readonly DubVoice[]>;

export type SpeakerChoice = { gender: SpeakerGender; voice: DubVoice };

const isVoice = (voice: string): voice is DubVoice =>
  [...VOICES.male, ...VOICES.female].some((known) => known === voice);

export function choiceOf(speaker: AssetDubSpeaker): SpeakerChoice {
  const voice = isVoice(speaker.voice) ? speaker.voice : VOICES[speaker.gender][0];
  return { gender: speaker.gender, voice };
}

/** The same place in the other gender's list, so a corrected gender keeps a distinct voice. */
export function withGender(choice: SpeakerChoice, gender: SpeakerGender): SpeakerChoice {
  if (gender === choice.gender) return choice;
  const index = Math.max(
    0,
    VOICES[choice.gender].findIndex((v) => v === choice.voice),
  );
  return { gender, voice: VOICES[gender][index] ?? VOICES[gender][0] };
}

/** Only what differs from what the dub found; the worker keeps the rest. */
export function overridesOf(
  speakers: readonly AssetDubSpeaker[],
  choices: Readonly<Record<string, SpeakerChoice>>,
): SpeakerOverrides {
  const overrides: SpeakerOverrides = {};
  for (const speaker of speakers) {
    const choice = choices[speaker.id];
    const found = choiceOf(speaker);
    if (choice && (choice.gender !== found.gender || choice.voice !== found.voice)) {
      overrides[speaker.id] = { gender: choice.gender, voice: choice.voice };
    }
  }
  return overrides;
}
