import { type Job, type JobResult, type JobStatus } from '../../../features/jobs';
import { type Upload, type UploadProblem } from '../../../features/upload';

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
    const stage =
      upload.phase === 'uploading'
        ? { phase: upload.phase, progress: upload.progress }
        : upload.phase === 'creating'
          ? { phase: upload.phase }
          : { phase: upload.phase, problem: upload.problem, detail: upload.detail };
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
