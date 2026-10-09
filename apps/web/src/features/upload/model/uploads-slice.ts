import { createEntityAdapter, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { type FileProblem } from '../lib/validate-file';

export type UploadProblem = FileProblem | 'unauthorized' | 'network' | 'rejected';

export type Upload = {
  id: string;
  fileName: string;
  previewUrl: string;
  createdAt: number;
} & (
  | { phase: 'uploading'; progress: number }
  | { phase: 'creating' }
  | { phase: 'submitted'; jobId: string }
  | { phase: 'failed'; problem: UploadProblem; detail: string | null }
);

const adapter = createEntityAdapter<Upload>({
  sortComparer: (a, b) => b.createdAt - a.createdAt,
});

type UploadsState = ReturnType<typeof adapter.getInitialState>;
type UploadBase = Pick<Upload, 'id' | 'fileName' | 'previewUrl' | 'createdAt'>;

/** Replaces the whole entity, so no field of the previous phase survives. */
function moveTo(state: UploadsState, id: string, next: (base: UploadBase) => Upload): void {
  const upload = state.entities[id];
  if (!upload) return;
  const { fileName, previewUrl, createdAt } = upload;
  adapter.setOne(state, next({ id, fileName, previewUrl, createdAt }));
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
    uploadDismissed(state, action: PayloadAction<string>) {
      adapter.removeOne(state, action.payload);
    },
  },
});

export const {
  uploadStarted,
  uploadProgressed,
  uploadStored,
  uploadSubmitted,
  uploadFailed,
  uploadDismissed,
} = uploadsSlice.actions;

const selectors = adapter.getSelectors(
  (state: { [uploadsSlice.reducerPath]: ReturnType<typeof uploadsSlice.reducer> }) =>
    state[uploadsSlice.reducerPath],
);
export const selectUploads = selectors.selectAll;
