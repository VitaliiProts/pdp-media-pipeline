import {
  dubCheckpointKey,
  type DubStep,
  dubSubtitlesKey,
  type DubTargetLanguage,
  type DubVoice,
  dubVideoKey,
  type MediaSource,
  mediaSourceOf,
  VideoDubInputV1,
  type VideoDubOutputV1,
  voiceGender,
} from '@pdp/contracts';
import {
  type FetchLimits,
  type JobContext,
  type JobProcessor,
  PermanentError,
} from '@pdp/worker-kit';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalyzeResponse } from './audio-separate/audio-separate.api';
import {
  CHECKPOINT,
  DubCheckpoints,
  type DubStorage,
  RefitCheckpoint,
  REUSABLE,
  TranscriptCheckpoint,
  TranslationCheckpoint,
} from './checkpoints';
import { type DubProviders } from './dub-providers';
import { dubUsage } from './dub-usage';
import {
  chooseVariant,
  charBudget,
  fitError,
  fitStats,
  needsRefit,
  placePhrases,
  refitWords,
  slotOf,
  speechOf,
} from './fit/fit';
import { type Phrase, toPhrases } from './fit/phrases';
import { assignVoices, listenerOf } from './fit/speakers';
import { spoken } from './fit/spoken';
import { type VoiceProfiles } from './fit/voice-profiles';
import { type DubFfmpeg } from './media/dub-ffmpeg';
import { encodeWav, renderVoiceTrack, toVtt } from './media/dub-media';
import { type GenderHint, type Translation } from './providers/types';

export interface VideoDubDeps {
  download: (source: MediaSource, path: string, limits: FetchLimits) => Promise<void>;
  media: Pick<DubFfmpeg, 'probe' | 'extractAudio' | 'speechAudio' | 'mix' | 'mux'>;
  storage: DubStorage;
  providers: DubProviders;
  profiles: VoiceProfiles;
}

export interface VideoDubOptions {
  maxSourceBytes: number;
  downloadTimeoutMs: number;
  maxDurationSeconds: number;
  workDir?: string;
}

/** Where each step starts, from the measured time of a minute of video (ADR-016). */
const STEP_PERCENT: Record<DubStep, number> = {
  extract: 0,
  separate: 5,
  align: 45,
  translate: 65,
  voice: 75,
  mix: 92,
};
/** 100% is left for `succeeded`. */
const MAX_REPORTED_PERCENT = 99;
/** Separated stereo FLAC of a minute is about 10 MB. */
const MAX_AUDIO_BYTES = 200_000_000;

interface Speaker {
  id: string;
  gender: GenderHint;
  maleProbability: number;
  seconds: number;
}

interface Choice {
  text: string;
  seconds: number;
  fullest: string;
  fullestSeconds: number;
  refitted: boolean;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * One job with checkpoints (ADR-016): each paid step is stored under `results/{jobId}/dub/` and
 * found there by a retry. Voicing and mixing take seconds and are always redone.
 */
export class VideoDubProcessor implements JobProcessor<VideoDubInputV1> {
  readonly type = 'video.dub';
  readonly inputSchema = VideoDubInputV1;

  constructor(
    private readonly deps: VideoDubDeps,
    private readonly options: VideoDubOptions,
  ) {}

  async process(job: JobContext, input: VideoDubInputV1): Promise<VideoDubOutputV1> {
    const dir = await mkdtemp(join(this.options.workDir ?? tmpdir(), `dub-${job.jobId}-`));
    try {
      return await this.dub(job, input, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async dub(
    job: JobContext,
    input: VideoDubInputV1,
    dir: string,
  ): Promise<VideoDubOutputV1> {
    const { storage, media, providers, profiles } = this.deps;
    const { signal } = job;
    const target = input.targetLanguage;
    const checkpoints = new DubCheckpoints(storage, job.jobId);
    const report = (step: DubStep, within = 0) => {
      const steps = Object.keys(STEP_PERCENT) as DubStep[];
      const start = STEP_PERCENT[step];
      const next = steps[steps.indexOf(step) + 1];
      const end = next ? STEP_PERCENT[next] : MAX_REPORTED_PERCENT;
      job.progress(start + (end - start) * within, step);
    };

    report('extract');
    const source = join(dir, 'source');
    await this.deps.download(mediaSourceOf(input), source, {
      maxBytes: this.options.maxSourceBytes,
      timeoutMs: this.options.downloadTimeoutMs,
    });
    const { durationSeconds } = await media.probe(source, this.options.maxDurationSeconds, signal);
    const reusedRecognition =
      input.reuseOf !== undefined &&
      (await storage.exists(dubCheckpointKey(input.reuseOf, CHECKPOINT.transcript)));
    if (input.reuseOf) await checkpoints.copyFrom(input.reuseOf, REUSABLE);

    const audio = join(dir, 'audio.flac');
    let extracted: Promise<void> | undefined;
    const extract = () => (extracted ??= media.extractAudio(source, audio, signal));
    if (!(await checkpoints.has(CHECKPOINT.audio))) {
      await extract();
      await storage.uploadFile(checkpoints.key(CHECKPOINT.audio), audio, 'audio/flac');
    }

    report('separate');
    const separation = new AbortController();
    const [transcript] = await Promise.all([
      checkpoints
        .json(CHECKPOINT.transcript, TranscriptCheckpoint, async () => {
          await extract();
          const speech = join(dir, 'speech.flac');
          await media.speechAudio(audio, speech, signal);
          return providers.stt.transcribe({ path: speech, durationSeconds }, signal);
        })
        .catch((err: unknown) => {
          separation.abort();
          throw err;
        }),
      this.separate(checkpoints, AbortSignal.any([signal, separation.signal])),
    ]);
    const segments = transcript.segments.filter((s) => s.text.trim());
    if (segments.length === 0) {
      throw new PermanentError('no speech was recognised', 'no_speech');
    }

    report('align');
    const analysis = await checkpoints.json(
      CHECKPOINT.analysis,
      AnalyzeResponse,
      () =>
        providers.audioSeparate.analyze(
          {
            vocals: checkpoints.key(CHECKPOINT.vocals),
            segments: segments.map(({ id, speaker, start, end, text }) => ({
              id,
              speaker,
              start,
              end,
              text,
            })),
            output: checkpoints.key(CHECKPOINT.analysis),
          },
          signal,
        ),
      { storedByCompute: true },
    );
    const phrases = toPhrases(segments, analysis.segments);
    const speakers = speakersOf(phrases, analysis);
    const voices = assignVoices(speakers, input.speakers);
    const voiceOf = (p: Phrase) => voices.get(p.speaker)!.voice;
    const genderOf = (speaker: string | null): GenderHint =>
      speaker === null ? 'unknown' : voices.get(speaker)!.gender;

    report('translate');
    const charsPerSecond = new Map<DubVoice, number>();
    for (const { voice } of voices.values()) {
      if (!charsPerSecond.has(voice)) {
        charsPerSecond.set(voice, (await profiles.profile(target, voice)).charsPerSecond);
      }
    }
    const translation = await checkpoints.json(CHECKPOINT.translation, TranslationCheckpoint, () =>
      providers.translator.translate(
        {
          targetLanguage: target,
          sourceLanguage: input.sourceLanguage,
          lines: phrases.map((p, i) => ({
            id: p.id,
            turn: p.turn,
            speaker: p.speaker,
            speakerGender: genderOf(p.speaker),
            listenerGender: genderOf(listenerOf(phrases, i)),
            text: p.text,
            seconds: round1(speechOf(phrases, i, durationSeconds)),
            maxChars: charBudget(
              slotOf(phrases, i, durationSeconds),
              charsPerSecond.get(voiceOf(p))!,
            ),
          })),
        },
        signal,
      ),
    );
    const sourceLanguage = sourceLanguageOf(input, translation, target);

    const variantsOf = new Map(
      translation.lines.map((l) => [l.id, l.variants.map(spoken).filter(Boolean)]),
    );
    // A phrase with nothing speakable left is not voiced; its time goes to its neighbours.
    const dubbed = phrases.filter((p) => (variantsOf.get(p.id)?.length ?? 0) > 0);
    const speechAt = (i: number) => speechOf(dubbed, i, durationSeconds);
    const slotAt = (i: number) => slotOf(dubbed, i, durationSeconds);
    const predict = (text: string, p: Phrase) => profiles.predict(text, target, voiceOf(p));
    const choices: Choice[] = await Promise.all(
      dubbed.map(async (p, i) => {
        const variants = variantsOf.get(p.id)!;
        const predicted = await Promise.all(variants.map((v) => predict(v, p)));
        const k = chooseVariant(predicted, speechAt(i), slotAt(i));
        return {
          text: variants[k]!,
          seconds: predicted[k]!,
          fullest: variants[0]!,
          fullestSeconds: predicted[0]!,
          refitted: false,
        };
      }),
    );

    const misfits = dubbed.flatMap((_, i) =>
      needsRefit(choices[i]!.seconds, speechAt(i), slotAt(i)) ? [i] : [],
    );
    const sameTurn = (i: number, j: number) => dubbed[j]?.turn === dubbed[i]!.turn;
    const refits = (await checkpoints.read(CHECKPOINT.refit, RefitCheckpoint)) ?? {};
    const missing = misfits.filter((i) => !refits[dubbed[i]!.id]);
    if (missing.length > 0) {
      const results = await Promise.all(
        missing.map((i) => {
          const p = dubbed[i]!;
          const choice = choices[i]!;
          return providers.translator.refit(
            {
              targetLanguage: target,
              original: p.text,
              fullest: choice.fullest,
              words: refitWords(
                wordCount(choice.fullest),
                choice.fullestSeconds,
                speechAt(i),
                slotAt(i),
              ),
              before: sameTurn(i, i - 1) ? choices[i - 1]!.text : null,
              after: sameTurn(i, i + 1) ? choices[i + 1]!.text : null,
              speakerGender: genderOf(p.speaker),
              listenerGender: genderOf(listenerOf(dubbed, i)),
            },
            signal,
          );
        }),
      );
      missing.forEach((i, k) => (refits[dubbed[i]!.id] = results[k]!));
      await checkpoints.write(CHECKPOINT.refit, refits);
    }
    for (const i of misfits) {
      const p = dubbed[i]!;
      for (const candidate of (refits[p.id]?.variants ?? []).map(spoken).filter(Boolean)) {
        const predicted = await predict(candidate, p);
        const current = choices[i]!;
        if (
          fitError(predicted, speechAt(i), slotAt(i)) >=
          fitError(current.seconds, speechAt(i), slotAt(i))
        ) {
          continue;
        }
        choices[i] = { ...current, text: candidate, seconds: predicted, refitted: true };
      }
    }

    report('voice');
    const placements = placePhrases(
      dubbed,
      choices.map((c) => c.seconds),
      durationSeconds,
    );
    const clips: { startSeconds: number; samples: Float32Array }[] = [];
    for (const [i, p] of dubbed.entries()) {
      signal.throwIfAborted();
      const samples = await providers.tts.synthesize(
        choices[i]!.text,
        target,
        voiceOf(p),
        placements[i]!.speed,
      );
      clips.push({ startSeconds: placements[i]!.placedStart, samples });
      report('voice', (i + 1) / dubbed.length);
    }
    const voiceTrack = join(dir, 'voice.wav');
    const { sampleRate } = providers.tts;
    await writeFile(
      voiceTrack,
      encodeWav(renderVoiceTrack(clips, durationSeconds, sampleRate), sampleRate),
    );

    report('mix');
    const background = join(dir, 'background.flac');
    await storage.downloadToFile(
      checkpoints.key(CHECKPOINT.background),
      background,
      MAX_AUDIO_BYTES,
    );
    const dubAudio = join(dir, 'dub.m4a');
    await media.mix(background, voiceTrack, dubAudio, signal);
    const video = join(dir, 'dubbed.mp4');
    await media.mux(source, dubAudio, video, { target, original: sourceLanguage }, signal);
    const videoKey = dubVideoKey(job.jobId);
    const bytes = await storage.uploadFile(videoKey, video, 'video/mp4');
    const subtitlesKey = dubSubtitlesKey(job.jobId);
    const cues = placements.map((pl, i) => ({
      start: pl.placedStart,
      end: pl.placedEnd,
      text: choices[i]!.text,
    }));
    await storage.putObject(subtitlesKey, Buffer.from(toVtt(cues)), 'text/vtt');

    const tokens = [translation.usage, ...Object.values(refits).map((r) => r.usage)];
    return {
      durationSeconds,
      sourceLanguage,
      targetLanguage: target,
      video: { key: videoKey, bytes },
      subtitles: { key: subtitlesKey },
      speakers: speakers.map(({ id, maleProbability, seconds }) => {
        const { gender, voice } = voices.get(id)!;
        return {
          id,
          gender: gender === 'unknown' ? voiceGender(voice) : gender,
          maleProbability,
          voice,
          seconds: round3(seconds),
        };
      }),
      phrases: dubbed.map((p, i) => ({
        id: p.id,
        turn: p.turn,
        speaker: p.speaker,
        start: round3(p.start),
        end: round3(p.end),
        source: p.text,
        target: choices[i]!.text,
        placedStart: round3(placements[i]!.placedStart),
        placedEnd: round3(placements[i]!.placedEnd),
        speed: round3(placements[i]!.speed),
        refitted: choices[i]!.refitted,
      })),
      unrecognized: analysis.unrecognized,
      stats: fitStats(
        dubbed,
        placements,
        choices.map((c) => c.refitted),
      ),
      usage: dubUsage(reusedRecognition ? 0 : transcript.billedSeconds, tokens),
    };
  }

  private async separate(checkpoints: DubCheckpoints, signal: AbortSignal): Promise<void> {
    const [vocals, background] = await Promise.all([
      checkpoints.has(CHECKPOINT.vocals),
      checkpoints.has(CHECKPOINT.background),
    ]);
    if (vocals && background) return;
    await this.deps.providers.audioSeparate.separate(
      {
        input: checkpoints.key(CHECKPOINT.audio),
        vocals: checkpoints.key(CHECKPOINT.vocals),
        background: checkpoints.key(CHECKPOINT.background),
      },
      signal,
    );
  }
}

/** In order of first appearance; the classifier's view where it has one. */
function speakersOf(phrases: readonly Phrase[], analysis: AnalyzeResponse): Speaker[] {
  const spokenSeconds = new Map<string, number>();
  for (const p of phrases) {
    spokenSeconds.set(p.speaker, (spokenSeconds.get(p.speaker) ?? 0) + p.end - p.start);
  }
  const classified = new Map(analysis.speakers.map((s) => [s.id, s]));
  return [...spokenSeconds].map(([id, seconds]) => {
    const found = classified.get(id);
    return found
      ? { id, gender: found.gender, maleProbability: found.maleProbability, seconds: found.seconds }
      : { id, gender: 'unknown', maleProbability: 0.5, seconds };
  });
}

function sourceLanguageOf(
  input: VideoDubInputV1,
  translation: Translation,
  target: DubTargetLanguage,
): string {
  if (input.sourceLanguage !== 'auto') return input.sourceLanguage;
  const detected = /^[a-z]{2}/.exec(translation.sourceLanguage.toLowerCase())?.[0];
  if (!detected) {
    throw new PermanentError(
      `the translator named no language of the original: ${translation.sourceLanguage}`,
      'provider_rejected',
    );
  }
  if (detected === target) {
    throw new PermanentError(`the speech is already in ${target}`, 'same_language');
  }
  return detected;
}
