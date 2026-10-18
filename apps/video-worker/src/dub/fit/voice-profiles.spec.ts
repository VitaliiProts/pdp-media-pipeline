import { FakeTextToSpeech } from '../providers/fake';
import { CALIBRATION_LINES, VoiceProfiles } from './voice-profiles';

/** Speaks 0.3 s longer than it predicts, like Supertonic with a voice that pads more. */
class BiasedTts extends FakeTextToSpeech {
  override async synthesize(...args: Parameters<FakeTextToSpeech['synthesize']>) {
    const wav = await super.synthesize(...args);
    const longer = new Float32Array(wav.length + Math.round(0.3 * this.sampleRate));
    longer.set(wav);
    return longer;
  }
}

describe('VoiceProfiles', () => {
  it('measures the speech rate of a voice in a language on the calibration lines', async () => {
    const profile = await new VoiceProfiles(new FakeTextToSpeech()).profile('uk', 'F1');
    expect(profile.charsPerSecond).toBeCloseTo(15, 1);
    expect(profile.predictionBiasSeconds).toBeCloseTo(0, 2);
  });

  it('corrects predictions by what the voice really takes', async () => {
    const profiles = new VoiceProfiles(new BiasedTts());
    const text = 'Wir treffen uns um halb acht.';
    expect(await profiles.predict(text, 'de', 'M1')).toBeCloseTo(text.length / 15 + 0.3, 2);
  });

  it('calibrates every voice and language once', async () => {
    const tts = new FakeTextToSpeech();
    const synthesize = jest.spyOn(tts, 'synthesize');
    const profiles = new VoiceProfiles(tts);
    await Promise.all([
      profiles.profile('es', 'M2'),
      profiles.profile('es', 'M2'),
      profiles.predict('Hola.', 'es', 'M2'),
    ]);
    expect(synthesize).toHaveBeenCalledTimes(CALIBRATION_LINES.es.length);
  });
});
