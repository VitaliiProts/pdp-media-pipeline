import { type AssetDub, type AssetJob } from '../../../features/assets';

/** Mirrors `DUB_STEPS` in @pdp/contracts; speech recognition runs during `separate`. */
export const DUB_STEPS = ['extract', 'separate', 'align', 'translate', 'voice', 'mix'] as const;
export type DubStep = (typeof DUB_STEPS)[number];

/** Codes the dub worker puts before `lastError`. */
const DUB_FAILURES = [
  'no_audio',
  'no_speech',
  'same_language',
  'too_long',
  'stt_unavailable',
  'translate_unavailable',
] as const;
export type DubFailure = (typeof DUB_FAILURES)[number] | 'other';

export function failureOf(lastError: string | null): DubFailure | null {
  if (!lastError) return null;
  const code = lastError.slice(0, Math.max(0, lastError.indexOf(':')));
  return DUB_FAILURES.find((known) => known === code) ?? 'other';
}

/** What the dub was asked for; the input is the gateway's echo of the request. */
export type DubRequest = { targetLanguage: string; sourceLanguage: string };

export function requestOf(job: AssetJob): DubRequest {
  const { targetLanguage, sourceLanguage } = job.input ?? {};
  return {
    targetLanguage: typeof targetLanguage === 'string' ? targetLanguage : '',
    sourceLanguage: typeof sourceLanguage === 'string' ? sourceLanguage : 'auto',
  };
}

export type DubStage =
  /** Not started, or waiting for another attempt after `retrying`. */
  | { kind: 'waiting'; retrying: DubFailure | null }
  | { kind: 'running'; step: DubStep | null; percent: number | null }
  | { kind: 'failed'; failure: DubFailure }
  | { kind: 'done'; dub: AssetDub };

export function stageOf(job: AssetJob): DubStage {
  switch (job.status) {
    case 'queued':
    case 'scheduled':
      return { kind: 'waiting', retrying: job.attempts > 0 ? failureOf(job.lastError) : null };
    case 'running':
      return {
        kind: 'running',
        step: DUB_STEPS.find((step) => step === job.progressStep) ?? null,
        percent: job.progress ?? null,
      };
    case 'succeeded':
      return job.dub ? { kind: 'done', dub: job.dub } : { kind: 'failed', failure: 'other' };
    case 'failed':
    case 'dead':
      return { kind: 'failed', failure: failureOf(job.lastError) ?? 'other' };
  }
}

export type StepState = 'done' | 'current' | 'pending';

export function stepStateOf(step: DubStep, current: DubStep | null): StepState {
  if (current === null) return 'pending';
  const at = DUB_STEPS.indexOf(current);
  const index = DUB_STEPS.indexOf(step);
  return index < at ? 'done' : index === at ? 'current' : 'pending';
}
