import { type Job, type JobResult, type JobStatus } from '../../../features/jobs';
import { type Upload, type UploadProblem, type WaitReason } from '../../../features/upload';

export type SheetItem =
  | {
      kind: 'local';
      key: string;
      uploadId: string;
      title: string;
      previewUrl: string;
      stage:
        | { phase: 'uploading'; progress: number }
        | { phase: 'creating' }
        | { phase: 'waiting'; reason: WaitReason; retryAt: number }
        | { phase: 'failed'; problem: UploadProblem; detail: string | null };
    }
  | {
      kind: 'job';
      key: string;
      jobId: string;
      /** Known only for files uploaded in this browser session. */
      title: string | null;
      previewUrl: string | null;
      status: JobStatus;
      attempts: number;
      lastError: string | null;
      results: JobResult[];
    };

type LocalStage = Extract<SheetItem, { kind: 'local' }>['stage'];

function stageOf(upload: Exclude<Upload, { phase: 'submitted' }>): LocalStage {
  switch (upload.phase) {
    case 'uploading':
      return { phase: upload.phase, progress: upload.progress };
    case 'creating':
      return { phase: upload.phase };
    case 'waiting':
      return { phase: upload.phase, reason: upload.reason, retryAt: upload.retryAt };
    case 'failed':
      return { phase: upload.phase, problem: upload.problem, detail: upload.detail };
  }
}

const PREFERRED_PREVIEW = 'medium';

function previewOf(job: Job, localPreview: string | null): string | null {
  const results = job.results ?? [];
  const best = results.find((r) => r.preset === PREFERRED_PREVIEW) ?? results[0];
  return best?.url ?? localPreview;
}

/**
 * Uploads still in flight come first; once an upload became a job it is shown
 * through the server's record, enriched with the local file name and preview.
 */
export function buildSheetItems(jobs: readonly Job[], uploads: readonly Upload[]): SheetItem[] {
  const byJobId = new Map<string, Upload>();
  const local: SheetItem[] = [];

  for (const upload of uploads) {
    if (upload.phase === 'submitted') {
      byJobId.set(upload.jobId, upload);
      continue;
    }
    const stage = stageOf(upload);
    local.push({
      kind: 'local',
      key: `upload:${upload.id}`,
      uploadId: upload.id,
      title: upload.fileName,
      previewUrl: upload.previewUrl,
      stage,
    });
  }

  const remote: SheetItem[] = jobs.map((job) => {
    const upload = byJobId.get(job.id);
    return {
      kind: 'job',
      key: `job:${job.id}`,
      jobId: job.id,
      title: upload?.fileName ?? null,
      previewUrl: previewOf(job, upload?.previewUrl ?? null),
      status: job.status,
      attempts: job.attempts,
      lastError: job.lastError,
      results: job.results ?? [],
    };
  });

  return [...local, ...remote];
}
