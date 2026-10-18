import { DUB_STEPS, VideoDubInputV1, VideoDubOutputV1 } from '@pdp/contracts';
import { startTestMetrics, startTestTracing } from '@pdp/observability/testing';
import { isPermanentError, PermanentError } from '@pdp/worker-kit';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeAudioSeparate } from './audio-separate/fake-audio-separate';
import { type DubStorage } from './checkpoints';
import { VoiceProfiles } from './fit/voice-profiles';
import { FakeSpeechToText, FakeTextToSpeech, FakeTranslator } from './providers/fake';
import { type TranslationRequest } from './providers/types';
import { type VideoDubDeps, VideoDubProcessor } from './video-dub.processor';

class MemoryStorage implements DubStorage {
  readonly objects = new Map<string, Buffer>();

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  getObject(key: string): Promise<Buffer> {
    const body = this.objects.get(key);
    return body ? Promise.resolve(body) : Promise.reject(new Error(`no ${key}`));
  }

  putObject(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
    return Promise.resolve();
  }

  async downloadToFile(key: string, path: string): Promise<number> {
    const body = await this.getObject(key);
    await writeFile(path, body);
    return body.length;
  }

  async uploadFile(key: string, path: string): Promise<number> {
    const body = await readFile(path);
    this.objects.set(key, body);
    return body.length;
  }

  async copyObject(source: string, target: string): Promise<void> {
    this.objects.set(target, await this.getObject(source));
  }

  json(key: string): unknown {
    return JSON.parse(this.objects.get(key)!.toString('utf8'));
  }
}

const SOURCE_KEY = 'uploads/u1/a1/clip.mp4';
const PREVIOUS = '00000000-0000-4000-8000-000000000001';
const input = (extra: Record<string, unknown> = {}) =>
  VideoDubInputV1.parse({ sourceKey: SOURCE_KEY, targetLanguage: 'uk', ...extra });

async function setup(storage = new MemoryStorage()) {
  const workDir = await mkdtemp(join(tmpdir(), 'video-dub-spec-'));
  const stt = new FakeSpeechToText();
  const translator = new FakeTranslator();
  const tts = new FakeTextToSpeech();
  const audioSeparate = new FakeAudioSeparate(storage);
  const media = {
    probe: jest.fn((_path: string, _max: number) => Promise.resolve({ durationSeconds: 12 })),
    extractAudio: jest.fn((_source: string, output: string) => writeFile(output, 'flac')),
    speechAudio: jest.fn((_audio: string, output: string) => writeFile(output, 'speech')),
    mix: jest.fn((_background: string, _voice: string, output: string) => writeFile(output, 'm4a')),
    mux: jest.fn(
      (_source: string, _dub: string, output: string, _languages: Record<string, string>) =>
        writeFile(output, 'dubbed mp4'),
    ),
  };
  const deps: VideoDubDeps = {
    download: jest.fn((_source, path: string) => writeFile(path, 'video')),
    media,
    storage,
    providers: { stt, translator, tts, audioSeparate },
    profiles: new VoiceProfiles(tts),
  };
  const spies = {
    transcribe: jest.spyOn(stt, 'transcribe'),
    translate: jest.spyOn(translator, 'translate'),
    refit: jest.spyOn(translator, 'refit'),
    synthesize: jest.spyOn(tts, 'synthesize'),
    separate: jest.spyOn(audioSeparate, 'separate'),
    analyze: jest.spyOn(audioSeparate, 'analyze'),
  };
  const processor = new VideoDubProcessor(deps, {
    maxSourceBytes: 1_000_000,
    downloadTimeoutMs: 5000,
    maxDurationSeconds: 60,
    workDir,
  });
  const job = (jobId = 'j1') => ({
    jobId,
    attempt: 1,
    progress: jest.fn<void, [number, string?]>(),
    signal: new AbortController().signal,
  });
  return { storage, media, spies, processor, job, workDir };
}

describe('VideoDubProcessor', () => {
  it('dubs a clip and stores the video and subtitles under deterministic keys', async () => {
    const { storage, media, spies, processor, job, workDir } = await setup();
    const output = await processor.process(job(), input());

    expect(VideoDubOutputV1.parse(output)).toEqual(output);
    expect(output).toMatchObject({
      durationSeconds: 12,
      sourceLanguage: 'en',
      targetLanguage: 'uk',
      video: { key: 'results/j1/dubbed.mp4', bytes: 'dubbed mp4'.length },
      subtitles: { key: 'results/j1/dubbed.vtt' },
      speakers: [
        { id: 'A', gender: 'male', maleProbability: 0.9, voice: 'M1' },
        { id: 'B', gender: 'female', maleProbability: 0.1, voice: 'F1' },
      ],
      unrecognized: [],
    });
    expect(output.phrases.map((p) => [p.id, p.speaker])).toEqual([
      ['1', 'A'],
      ['2', 'B'],
      ['3', 'A'],
    ]);
    expect(output.stats.phrases).toBe(3);
    expect(spies.synthesize).toHaveBeenCalledTimes(3 + 2 * 3);

    const vtt = storage.objects.get('results/j1/dubbed.vtt')!.toString('utf8');
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain(output.phrases[0]!.target);
    expect(media.mux.mock.calls[0]?.[3]).toEqual({ target: 'uk', original: 'en' });
    expect(media.probe.mock.calls[0]?.[1]).toBe(60);

    for (const name of ['audio.flac', 'transcript.json', 'vocals.flac', 'background.flac']) {
      expect(storage.objects.has(`results/j1/dub/${name}`)).toBe(true);
    }
    expect(storage.objects.has('results/j1/dub/analysis.json')).toBe(true);
    expect(storage.objects.has('results/j1/dub/translation.json')).toBe(true);
    expect(await readdir(workDir)).toEqual([]);
  });

  it('reports every step in order with a percentage that never goes back', async () => {
    const { processor, job } = await setup();
    const context = job();
    await processor.process(context, input());

    const calls = context.progress.mock.calls;
    const steps = [...new Set(calls.map(([, step]) => step))];
    expect(steps).toEqual([...DUB_STEPS]);
    const percents = calls.map(([percent]) => percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(Math.max(...percents)).toBeLessThan(100);
  });

  it('spans and times every step and counts how the phrases fitted', async () => {
    const tracing = startTestTracing();
    const telemetry = startTestMetrics();
    try {
      const { processor, job } = await setup();
      const output = await processor.process(job(), input());

      expect(tracing.spans().filter((s) => s.name.startsWith('dub.step.'))).toHaveLength(6);
      for (const step of DUB_STEPS) {
        await expect(telemetry.value('dub.step.duration', { step, outcome: 'ok' })).resolves.toBe(
          1,
        );
      }
      await expect(telemetry.value('dub.phrases')).resolves.toBe(output.stats.phrases);
      await expect(telemetry.value('dub.phrases.adjusted', { adjustment: 'sped' })).resolves.toBe(
        output.stats.sped,
      );
    } finally {
      await telemetry.stop();
      await tracing.stop();
    }
  });

  it('pays for no finished step again when the job is retried', async () => {
    const storage = new MemoryStorage();
    const first = await setup(storage);
    await first.processor.process(first.job(), input());
    const retry = await setup(storage);
    const output = await retry.processor.process(retry.job(), input());

    expect(retry.spies.transcribe).not.toHaveBeenCalled();
    expect(retry.spies.separate).not.toHaveBeenCalled();
    expect(retry.spies.analyze).not.toHaveBeenCalled();
    expect(retry.spies.translate).not.toHaveBeenCalled();
    expect(output.phrases).toHaveLength(3);
  });

  it('reuses recognition and analysis of a previous dub and pays only for the translation', async () => {
    const storage = new MemoryStorage();
    const first = await setup(storage);
    await first.processor.process(first.job(PREVIOUS), input());
    const second = await setup(storage);
    second.spies.transcribe.mockResolvedValue({ segments: [], billedSeconds: 12 });
    const output = await second.processor.process(
      second.job('j2'),
      input({ reuseOf: PREVIOUS, speakers: { A: { voice: 'M3' } } }),
    );

    expect(second.spies.transcribe).not.toHaveBeenCalled();
    expect(second.spies.separate).not.toHaveBeenCalled();
    expect(second.spies.analyze).not.toHaveBeenCalled();
    expect(second.spies.translate).toHaveBeenCalledTimes(1);
    expect(storage.objects.has('results/j2/dub/transcript.json')).toBe(true);
    expect(output.speakers.map((s) => [s.id, s.voice])).toEqual([
      ['A', 'M3'],
      ['B', 'F1'],
    ]);
    expect(output.usage.audioSeconds).toBe(0);
  });

  it('computes what a previous dub no longer has', async () => {
    const { processor, job, spies } = await setup();
    await processor.process(job('j2'), input({ reuseOf: PREVIOUS }));

    expect(spies.transcribe).toHaveBeenCalledTimes(1);
    expect(spies.separate).toHaveBeenCalledTimes(1);
  });

  it('asks for a shorter phrasing where no variant fits and counts what it paid for', async () => {
    const { storage, processor, job, spies } = await setup();
    spies.translate.mockImplementation((request: TranslationRequest) =>
      Promise.resolve({
        sourceLanguage: 'en',
        lines: request.lines.map(({ id, text }) => ({ id, variants: [`${text} ${text} ${text}`] })),
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    );
    spies.refit.mockImplementation(async (request) => ({
      ...(await new FakeTranslator().refit(request)),
      usage: { inputTokens: 10, outputTokens: 5 },
    }));

    const output = await processor.process(job(), input());

    expect(spies.refit).toHaveBeenCalledTimes(3);
    expect(output.phrases.every((p) => p.refitted)).toBe(true);
    expect(output.stats.refitted).toBe(3);
    expect(output.usage).toMatchObject({ inputTokens: 130, outputTokens: 65 });
    expect(Object.keys(storage.json('results/j1/dub/refit.json') as object).sort()).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('fails permanently with no_speech when nothing was recognised, before translating', async () => {
    const { processor, job, spies } = await setup();
    spies.transcribe.mockResolvedValue({ segments: [], billedSeconds: 12 });

    const failure = processor.process(job(), input());
    await expect(failure).rejects.toMatchObject({ code: 'no_speech' });
    await failure.catch((err: unknown) => expect(isPermanentError(err)).toBe(true));
    expect(spies.translate).not.toHaveBeenCalled();
  });

  it('fails permanently with same_language when the speech is already in the dub language', async () => {
    const { processor, job, spies, media } = await setup();
    spies.translate.mockResolvedValue({
      sourceLanguage: 'uk',
      lines: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await expect(processor.process(job(), input())).rejects.toMatchObject({
      code: 'same_language',
    });
    expect(media.mix).not.toHaveBeenCalled();
  });

  it('checks the length before paying for anything', async () => {
    const { processor, job, media, spies, storage } = await setup();
    media.probe.mockRejectedValue(new PermanentError('the video is 75 s', 'too_long'));

    await expect(processor.process(job(), input())).rejects.toMatchObject({ code: 'too_long' });
    expect(spies.transcribe).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(0);
  });
});
