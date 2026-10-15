import { type DeadReason, STATUS_LABEL_KEY, type JobStatus } from '../../../features/jobs';
import { type UploadProblem, type WaitReason } from '../../../features/upload';
import { type SheetItem } from './sheet-items';

export type ItemTone = 'pending' | 'active' | 'done' | 'failed';

export type ItemDescription = {
  tone: ItemTone;
  /** Key in the `jobs` or `workspace` namespace, see `ns`. */
  label: { ns: 'jobs' | 'workspace'; key: string };
  progress: number | null;
  /** When an automatic retry is due, for a countdown. */
  retryAt: number | null;
  problem: { key: string; detail: string | null } | null;
};

const TONE_BY_STATUS: Record<JobStatus, ItemTone> = {
  queued: 'pending',
  scheduled: 'pending',
  running: 'active',
  succeeded: 'done',
  failed: 'failed',
  dead: 'failed',
};

const PROBLEM_KEY = {
  type: 'problem.type',
  size: 'problem.size',
  empty: 'problem.empty',
  unauthorized: 'problem.unauthorized',
  network: 'problem.network',
  rejected: 'problem.rejected',
  rateLimited: 'problem.rateLimited',
  queueFull: 'problem.queueFull',
  quotaExceeded: 'problem.quotaExceeded',
} as const satisfies Record<UploadProblem, string>;

const WAIT_LABEL_KEY = {
  rateLimited: 'stage.waitingRateLimit',
  queueFull: 'stage.waitingQueue',
} as const satisfies Record<WaitReason, string>;

const DEAD_PROBLEM_KEY = {
  permanent: 'problem.deadPermanent',
  exhausted: 'problem.deadExhausted',
} as const satisfies Record<DeadReason, string>;

function jobProblem(item: Extract<SheetItem, { kind: 'job' }>): ItemDescription['problem'] {
  if (item.status === 'dead' && item.deadReason) {
    return { key: DEAD_PROBLEM_KEY[item.deadReason], detail: item.lastError };
  }
  return item.lastError ? { key: 'problem.processing', detail: item.lastError } : null;
}

export function describeItem(item: SheetItem): ItemDescription {
  if (item.kind === 'job') {
    return {
      tone: TONE_BY_STATUS[item.status],
      label: { ns: 'jobs', key: STATUS_LABEL_KEY[item.status] },
      progress: item.progress,
      retryAt: null,
      problem: jobProblem(item),
    };
  }
  switch (item.stage.phase) {
    case 'uploading':
      return {
        tone: 'pending',
        label: { ns: 'workspace', key: 'stage.uploading' },
        progress: item.stage.progress,
        retryAt: null,
        problem: null,
      };
    case 'creating':
      return {
        tone: 'pending',
        label: { ns: 'workspace', key: 'stage.creating' },
        progress: 1,
        retryAt: null,
        problem: null,
      };
    case 'waiting':
      return {
        tone: 'pending',
        label: { ns: 'workspace', key: WAIT_LABEL_KEY[item.stage.reason] },
        progress: null,
        retryAt: item.stage.retryAt,
        problem: null,
      };
    case 'failed':
      return {
        tone: 'failed',
        label: { ns: 'workspace', key: 'stage.failed' },
        progress: null,
        retryAt: null,
        problem: { key: PROBLEM_KEY[item.stage.problem], detail: item.stage.detail },
      };
  }
}
