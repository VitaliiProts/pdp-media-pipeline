import { type Dispatch } from '@reduxjs/toolkit';
import { baseApi } from '../../../shared/api/base-api';
import { type AppError, toAppError } from '../../../shared/api/http';
import { createAppAsyncThunk } from '../../../shared/lib/redux';
import { createJob, type JobSpec, putToStorage, requestUpload } from '../api/upload-api';
import { checkFile, mediaKindOf } from '../lib/validate-file';
import { type ImagePreset, type VideoMode } from './presets';
import {
  selectUploads,
  uploadDismissed,
  uploadFailed,
  type UploadProblem,
  uploadProgressed,
  uploadRestarted,
  uploadsCleared,
  uploadStarted,
  uploadStored,
  uploadSubmitted,
  uploadWaiting,
  type WaitReason,
} from './uploads-slice';

const PARALLEL_UPLOADS = 3;
/** After this many waits the gateway is still refusing, so the user decides what to do. */
export const MAX_RETRY_LATER = 5;
/** Spreads retries of parallel uploads, so they do not come back in the same millisecond. */
const RETRY_JITTER_MS = 500;

/** `presets` apply to images, `videoMode` to videos. */
type UploadFilesArgs = {
  files: readonly File[];
  presets: readonly ImagePreset[];
  videoMode: VideoMode;
};

const reasonOf = (error: Extract<AppError, { kind: 'retryLater' }>): WaitReason =>
  error.status === 429 ? 'rateLimited' : 'queueFull';

function problemOf(error: AppError): { problem: UploadProblem; detail: string | null } {
  switch (error.kind) {
    case 'unauthorized':
      return { problem: 'unauthorized', detail: null };
    case 'retryLater':
      return { problem: reasonOf(error), detail: null };
    case 'http':
      return { problem: 'rejected', detail: error.message };
    default:
      return { problem: 'network', detail: null };
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    });
  });
}

/** Repeats `step` after every `Retry-After`, up to `MAX_RETRY_LATER` times. */
async function honouringRetryAfter<T>(
  step: () => Promise<T>,
  hooks: { onWait: (reason: WaitReason, retryAt: number) => void; onResume: () => void },
  signal: AbortSignal,
): Promise<T> {
  for (let waits = 0; ; waits++) {
    try {
      return await step();
    } catch (error) {
      const appError = toAppError(error);
      if (appError.kind !== 'retryLater' || waits >= MAX_RETRY_LATER) throw error;
      const delayMs = appError.retryAfterS * 1000 + Math.random() * RETRY_JITTER_MS;
      hooks.onWait(reasonOf(appError), Date.now() + delayMs);
      await sleep(delayMs, signal);
      hooks.onResume();
    }
  }
}

export const uploadFiles = createAppAsyncThunk(
  'uploads/uploadFiles',
  async ({ files, presets, videoMode }: UploadFilesArgs, { dispatch, signal: own, extra }) => {
    const signal = AbortSignal.any([own, extra.sessionSignal()]);
    const queue = files.map((file) => ({ file, id: crypto.randomUUID() }));

    for (const { file, id } of queue) {
      dispatch(
        uploadStarted({
          id,
          fileName: file.name,
          previewUrl: URL.createObjectURL(file),
          createdAt: Date.now(),
        }),
      );
      const problem = checkFile(file);
      if (problem) dispatch(uploadFailed({ id, problem, detail: null }));
    }

    const pending = queue.filter(({ file }) => checkFile(file) === null);
    const uploadOne = async ({ file, id }: (typeof queue)[number]) => {
      const spec: JobSpec =
        mediaKindOf(file.type) === 'video'
          ? { kind: 'video', mode: videoMode }
          : { kind: 'image', presets };
      const onWait = (reason: WaitReason, retryAt: number) =>
        dispatch(uploadWaiting({ id, reason, retryAt }));
      try {
        const ticket = await honouringRetryAfter(
          () => requestUpload(file, signal),
          { onWait, onResume: () => dispatch(uploadRestarted(id)) },
          signal,
        );
        await putToStorage(
          ticket.uploadUrl,
          file,
          (progress) => dispatch(uploadProgressed({ id, progress })),
          signal,
        );
        dispatch(uploadStored(id));
        const { jobId } = await honouringRetryAfter(
          () => createJob(ticket.sourceKey, spec, id, signal),
          { onWait, onResume: () => dispatch(uploadStored(id)) },
          signal,
        );
        dispatch(uploadSubmitted({ id, jobId }));
        dispatch(baseApi.util.invalidateTags(['Job']));
      } catch (error) {
        dispatch(uploadFailed({ id, ...problemOf(toAppError(error)) }));
      }
    };

    const workers = Array.from({ length: Math.min(PARALLEL_UPLOADS, pending.length) }, async () => {
      for (let next = pending.shift(); next; next = pending.shift()) await uploadOne(next);
    });
    await Promise.all(workers);
  },
);

/** Frees the local preview together with the entry. */
export const dismissUpload =
  ({ id, previewUrl }: { id: string; previewUrl: string }) =>
  (dispatch: Dispatch) => {
    URL.revokeObjectURL(previewUrl);
    dispatch(uploadDismissed(id));
  };

/** Frees every local preview and forgets every upload, e.g. when the user signs out. */
export const clearUploads =
  () => (dispatch: Dispatch, getState: () => Parameters<typeof selectUploads>[0]) => {
    for (const { previewUrl } of selectUploads(getState())) URL.revokeObjectURL(previewUrl);
    dispatch(uploadsCleared());
  };
