import { createEntityAdapter, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { type FileProblem, type MediaKind } from '../lib/validate-file';

export type UploadProblem =
  | FileProblem
  | 'unauthorized'
  | 'network'
  | 'rejected'
  | 'rateLimited'
  | 'queueFull'
  | 'quotaExceeded';

export type WaitReason = 'rateLimited' | 'queueFull';

export type Upload = {
  id: string;
  fileName: string;
  /** Picks the local preview: object URLs of videos do not render in an <img>. */
  kind: MediaKind;
  previewUrl: string;
  createdAt: number;
} & (
  | { phase: 'uploading'; progress: number }
  | { phase: 'creating' }
  /** The gateway asked to come back later; the same step is retried at `retryAt`. */
  | { phase: 'waiting'; reason: WaitReason; retryAt: number }
  /** `listed` once the library has shown the file the job made; it is no longer awaited there. */
  | { phase: 'submitted'; jobId: string; listed?: boolean }
  | { phase: 'failed'; problem: UploadProblem; detail: string | null }
);

const adapter = createEntityAdapter<Upload>({
  sortComparer: (a, b) => b.createdAt - a.createdAt,
});

type UploadsState = ReturnType<typeof adapter.getInitialState>;
type UploadBase = Pick<Upload, 'id' | 'fileName' | 'kind' | 'previewUrl' | 'createdAt'>;

/** Replaces the whole entity, so no field of the previous phase survives. */
function moveTo(state: UploadsState, id: string, next: (base: UploadBase) => Upload): void {
  const upload = state.entities[id];
  if (!upload) return;
  const { fileName, kind, previewUrl, createdAt } = upload;
  adapter.setOne(state, next({ id, fileName, kind, previewUrl, createdAt }));
}

export const uploadsSlice = createSlice({
  name: 'uploads',
  initialState: adapter.getInitialState(),
  reducers: {
    uploadStarted(
      state,
      action: PayloadAction<{
        id: string;
        fileName: string;
        kind: MediaKind;
        previewUrl: string;
        createdAt: number;
      }>,
    ) {
      adapter.addOne(state, { ...action.payload, phase: 'uploading', progress: 0 });
    },
    uploadProgressed(state, action: PayloadAction<{ id: string; progress: number }>) {
      const upload = state.entities[action.payload.id];
      if (upload?.phase === 'uploading') upload.progress = action.payload.progress;
    },
    uploadWaiting(
      state,
      action: PayloadAction<{ id: string; reason: WaitReason; retryAt: number }>,
    ) {
      const { id, reason, retryAt } = action.payload;
      moveTo(state, id, (base) => ({ ...base, phase: 'waiting', reason, retryAt }));
    },
    uploadRestarted(state, action: PayloadAction<string>) {
      moveTo(state, action.payload, (base) => ({ ...base, phase: 'uploading', progress: 0 }));
    },
    uploadStored(state, action: PayloadAction<string>) {
      moveTo(state, action.payload, (base) => ({ ...base, phase: 'creating' }));
    },
    uploadSubmitted(state, action: PayloadAction<{ id: string; jobId: string }>) {
      const { id, jobId } = action.payload;
      moveTo(state, id, (base) => ({ ...base, phase: 'submitted', jobId }));
    },
    uploadFailed(
      state,
      action: PayloadAction<{ id: string; problem: UploadProblem; detail: string | null }>,
    ) {
      const { id, problem, detail } = action.payload;
      moveTo(state, id, (base) => ({ ...base, phase: 'failed', problem, detail }));
    },
    /** The library listed files made by these jobs. */
    uploadsListed(state, action: PayloadAction<readonly string[]>) {
      const jobIds = new Set(action.payload);
      for (const upload of Object.values(state.entities)) {
        if (upload?.phase === 'submitted' && jobIds.has(upload.jobId)) upload.listed = true;
      }
    },
    uploadDismissed(state, action: PayloadAction<string>) {
      adapter.removeOne(state, action.payload);
    },
    uploadsCleared(state) {
      adapter.removeAll(state);
    },
  },
});

export const {
  uploadStarted,
  uploadProgressed,
  uploadWaiting,
  uploadRestarted,
  uploadStored,
  uploadSubmitted,
  uploadFailed,
  uploadDismissed,
  uploadsCleared,
  uploadsListed,
} = uploadsSlice.actions;

const selectors = adapter.getSelectors(
  (state: { [uploadsSlice.reducerPath]: ReturnType<typeof uploadsSlice.reducer> }) =>
    state[uploadsSlice.reducerPath],
);
export const selectUploads = selectors.selectAll;
