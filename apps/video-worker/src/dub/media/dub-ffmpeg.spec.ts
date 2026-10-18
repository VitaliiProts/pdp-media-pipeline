import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DubFfmpeg } from './dub-ffmpeg';
import { encodeWav } from './dub-media';

/* eslint-disable @typescript-eslint/no-require-imports -- the packages only export a path */
const ffmpegPath = require('ffmpeg-static') as string;
const ffprobePath = (require('@ffprobe-installer/ffprobe') as { path: string }).path;
/* eslint-enable @typescript-eslint/no-require-imports */

const run = promisify(execFile);

async function makeClip(path: string, seconds: number, withSound: boolean) {
  await run(ffmpegPath, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${seconds}:size=160x120:rate=5`,
    ...(withSound ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`] : []),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    ...(withSound ? ['-c:a', 'aac'] : []),
    '-y',
    path,
  ]);
}

interface Stream {
  codec_type: string;
  sample_rate?: string;
  channels?: number;
  tags?: { language?: string };
  disposition?: { default: number };
}

const streamsOf = async (path: string) =>
  (
    JSON.parse(
      (await run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_streams', path]))
        .stdout,
    ) as { streams: Stream[] }
  ).streams;

describe('DubFfmpeg', () => {
  const ffmpeg = new DubFfmpeg({ ffmpegPath, ffprobePath, timeoutMs: 30_000 });
  let dir: string;
  let clip: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dub-ffmpeg-'));
    clip = join(dir, 'clip.mp4');
    await makeClip(clip, 2, true);
  }, 30_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('probes the duration and refuses a silent video', async () => {
    const { durationSeconds } = await ffmpeg.probe(clip, 60);
    expect(durationSeconds).toBeCloseTo(2, 0);

    const silent = join(dir, 'silent.mp4');
    await makeClip(silent, 1, false);
    await expect(ffmpeg.probe(silent, 60)).rejects.toThrow('no_audio');
    await expect(ffmpeg.probe(clip, 1)).rejects.toThrow('too_long');
  }, 30_000);

  it('extracts the audio, mixes a voice over it and muxes the dub before the original', async () => {
    const audio = join(dir, 'audio.flac');
    const speech = join(dir, 'speech.flac');
    await ffmpeg.extractAudio(clip, audio);
    await ffmpeg.speechAudio(audio, speech);
    expect((await streamsOf(audio))[0]).toMatchObject({ sample_rate: '44100', channels: 2 });
    expect((await streamsOf(speech))[0]).toMatchObject({ sample_rate: '16000', channels: 1 });

    const voice = join(dir, 'voice.wav');
    await writeFile(voice, encodeWav(new Float32Array(24_000).fill(0.1), 24_000));
    const dub = join(dir, 'dub.m4a');
    await ffmpeg.mix(audio, voice, dub);

    const output = join(dir, 'dubbed.mp4');
    await ffmpeg.mux(clip, dub, output, { target: 'uk', original: 'en' });
    const streams = await streamsOf(output);
    expect(streams.map((s) => s.codec_type)).toEqual(['video', 'audio', 'audio']);
    expect(streams[1]).toMatchObject({ tags: { language: 'ukr' }, disposition: { default: 1 } });
    expect(streams[2]).toMatchObject({ tags: { language: 'eng' }, disposition: { default: 0 } });
    expect((await stat(output)).size).toBeGreaterThan(0);
  }, 60_000);
});
