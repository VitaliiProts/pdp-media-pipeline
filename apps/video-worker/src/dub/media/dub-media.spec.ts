import { PermanentError } from '@pdp/worker-kit';
import {
  encodeWav,
  extractAudioArgs,
  languageTag,
  mixArgs,
  muxArgs,
  parseDubProbe,
  renderVoiceTrack,
  speechAudioArgs,
  toVtt,
} from './dub-media';

const argAfter = (args: string[], flag: string, nth = 0) =>
  args.filter((_, i) => args[i - 1] === flag)[nth];

const probe = (streams: Record<string, unknown>[], duration = '42.0') =>
  JSON.stringify({ streams, format: { duration } });
const video = { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 };
const audio = { codec_type: 'audio', codec_name: 'aac' };

describe('parseDubProbe', () => {
  it('reads the duration of a video with sound', () => {
    expect(parseDubProbe(probe([video, audio]), 60)).toEqual({ durationSeconds: 42 });
  });

  it('rejects a video over the limit as too_long', () => {
    const err = (() => {
      try {
        parseDubProbe(probe([video, audio], '61.5'), 60);
      } catch (e) {
        return e as PermanentError;
      }
    })();
    expect(err).toBeInstanceOf(PermanentError);
    expect(err?.code).toBe('too_long');
    expect(err?.message).toContain('61.5s, limit 60s');
  });

  it('rejects a video without sound as no_audio', () => {
    expect(() => parseDubProbe(probe([video]), 60)).toThrow('no_audio:');
  });

  it('rejects what is not a video at all', () => {
    expect(() => parseDubProbe(probe([audio]), 60)).toThrow('no video stream');
  });
});

describe('ffmpeg arguments', () => {
  it('keeps the first sound track as 44.1 kHz stereo FLAC for the separation', () => {
    const args = extractAudioArgs('/w/in.mp4', '/w/audio.flac');
    expect(argAfter(args, '-map')).toBe('0:a:0');
    expect(args).toContain('-vn');
    expect(argAfter(args, '-ac')).toBe('2');
    expect(argAfter(args, '-ar')).toBe('44100');
    expect(argAfter(args, '-c:a')).toBe('flac');
    expect(args.at(-1)).toBe('/w/audio.flac');
  });

  it('gives recognition 16 kHz mono, as the spike measured it on', () => {
    const args = speechAudioArgs('/w/audio.flac', '/w/speech.flac');
    expect(argAfter(args, '-ac')).toBe('1');
    expect(argAfter(args, '-ar')).toBe('16000');
  });

  it('mixes the voice over the background without normalising', () => {
    const args = mixArgs('/w/background.flac', '/w/voice.wav', '/w/dub.m4a');
    expect(argAfter(args, '-i', 0)).toBe('/w/background.flac');
    expect(argAfter(args, '-i', 1)).toBe('/w/voice.wav');
    expect(argAfter(args, '-filter_complex')).toContain('amix=inputs=2:normalize=0:duration=first');
    expect(argAfter(args, '-c:a')).toBe('aac');
  });

  it('copies the video and puts the dub first and default, the original second', () => {
    const args = muxArgs('/w/in.mp4', '/w/dub.m4a', '/w/out.mp4', { target: 'uk', original: 'en' });
    expect(args.filter((_, i) => args[i - 1] === '-map')).toEqual(['0:v:0', '1:a:0', '0:a:0']);
    expect(argAfter(args, '-c:v')).toBe('copy');
    expect(argAfter(args, '-metadata:s:a:0')).toBe('language=ukr');
    expect(argAfter(args, '-disposition:a:0')).toBe('default');
    expect(argAfter(args, '-metadata:s:a:1')).toBe('language=eng');
    expect(argAfter(args, '-disposition:a:1')).toBe('0');
    expect(argAfter(args, '-movflags')).toBe('+faststart');
  });

  it('tags languages in ISO 639-2 and an unknown one as undetermined', () => {
    expect(['uk', 'de', 'en', 'es', 'fr', 'xx'].map(languageTag)).toEqual([
      'ukr',
      'deu',
      'eng',
      'spa',
      'fra',
      'und',
    ]);
  });
});

describe('renderVoiceTrack', () => {
  it('puts every clip at its place, adds overlaps and cuts at the end of the video', () => {
    const track = renderVoiceTrack(
      [
        { startSeconds: 0.1, samples: Float32Array.of(0.5, 0.5, 0.5) },
        { startSeconds: 0.3, samples: Float32Array.of(0.25, 0.25, 0.25) },
      ],
      0.4,
      10,
    );
    expect(Array.from(track)).toEqual([0, 0.5, 0.5, 0.75]);
  });
});

describe('encodeWav', () => {
  it('writes 16-bit mono PCM with a RIFF header and clips loud samples', () => {
    const wav = encodeWav(Float32Array.of(0, 1, -2), 24_000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt32LE(40)).toBe(6);
    expect([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48)]).toEqual([
      0, 32767, -32767,
    ]);
  });
});

describe('toVtt', () => {
  it('writes a cue per phrase with millisecond times and escaped text', () => {
    expect(
      toVtt([
        { start: 1.5, end: 3.25, text: 'Tom & Jerry <3' },
        { start: 3661.001, end: 3662, text: 'a --> b' },
      ]),
    ).toBe(
      [
        'WEBVTT',
        '',
        '00:00:01.500 --> 00:00:03.250',
        'Tom &amp; Jerry &lt;3',
        '',
        '01:01:01.001 --> 01:01:02.000',
        'a --&gt; b',
        '',
      ].join('\n'),
    );
  });
});
