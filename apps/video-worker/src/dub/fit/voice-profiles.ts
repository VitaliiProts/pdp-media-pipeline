import { type DubTargetLanguage, type DubVoice } from '@pdp/contracts';
import { type TextToSpeech } from '../providers/types';

/** The lines of spike 02 the rates in ADR-016 come from: plain, with a time, and emotional. */
export const CALIBRATION_LINES: Record<DubTargetLanguage, readonly string[]> = {
  uk: [
    'Слухай, нам треба поговорити про те, що сталося вчора.',
    'Зустрінемося о пів на восьму біля старого мосту, добре?',
    'Ти мене взагалі чуєш? Це справді важливо!',
  ],
  de: [
    'Hör zu, wir müssen darüber reden, was gestern passiert ist.',
    'Wir treffen uns um halb acht an der alten Brücke, okay?',
    'Hörst du mir überhaupt zu? Das ist wirklich wichtig!',
  ],
  en: [
    'Listen, we need to talk about what happened yesterday.',
    'Meet me at half past seven by the old bridge, okay?',
    'Are you even listening to me? This really matters!',
  ],
  es: [
    'Escucha, tenemos que hablar de lo que pasó ayer.',
    'Nos vemos a las siete y media junto al puente viejo, ¿vale?',
    '¿Me estás escuchando siquiera? ¡Esto es muy importante!',
  ],
  fr: [
    "Écoute, il faut qu'on parle de ce qui s'est passé hier.",
    'On se retrouve à sept heures et demie près du vieux pont, d’accord ?',
    "Tu m'écoutes au moins ? C'est vraiment important !",
  ],
};

export interface VoiceProfile {
  /** Speech rate at speed 1, for the character budget of the translation. */
  charsPerSecond: number;
  /** What the voice really takes beyond the prediction, once the silence is trimmed. */
  predictionBiasSeconds: number;
}

const MIN_SPEECH_SECONDS = 0.2;

/**
 * Rates differ from 14.6 to 25.6 characters a second by language and voice, and so does the
 * silence the predictor counts in. Each pair is measured on first use (three short syntheses)
 * and kept for the life of the pod.
 */
export class VoiceProfiles {
  private readonly profiles = new Map<string, Promise<VoiceProfile>>();

  constructor(private readonly tts: TextToSpeech) {}

  profile(language: DubTargetLanguage, voice: DubVoice): Promise<VoiceProfile> {
    const key = `${language}:${voice}`;
    let profile = this.profiles.get(key);
    if (!profile) {
      profile = this.calibrate(language, voice);
      profile.catch(() => this.profiles.delete(key));
      this.profiles.set(key, profile);
    }
    return profile;
  }

  /** The prediction of the synthesiser, corrected for this voice and language. */
  async predict(text: string, language: DubTargetLanguage, voice: DubVoice): Promise<number> {
    const [predicted, { predictionBiasSeconds }] = await Promise.all([
      this.tts.predict(text, language, voice),
      this.profile(language, voice),
    ]);
    return Math.max(MIN_SPEECH_SECONDS, predicted + predictionBiasSeconds);
  }

  private async calibrate(language: DubTargetLanguage, voice: DubVoice): Promise<VoiceProfile> {
    let chars = 0;
    let spoken = 0;
    let bias = 0;
    const lines = CALIBRATION_LINES[language];
    for (const line of lines) {
      const predicted = await this.tts.predict(line, language, voice);
      const seconds =
        (await this.tts.synthesize(line, language, voice, 1)).length / this.tts.sampleRate;
      chars += line.length;
      spoken += seconds;
      bias += seconds - predicted;
    }
    return { charsPerSecond: chars / spoken, predictionBiasSeconds: bias / lines.length };
  }
}
