import { createAsyncThunk, type Dispatch } from '@reduxjs/toolkit';
import { baseApi } from '../../../shared/api/base-api';
import { type AppError, toAppError } from '../../../shared/api/http';
import { createResizeJob, putToStorage, requestUpload } from '../api/upload-api';
import { checkFile } from '../lib/validate-file';
import { type ImagePreset } from './presets';
import {
  uploadDismissed,
  uploadFailed,
  type UploadProblem,
  uploadProgressed,
  uploadStarted,
  uploadStored,
  uploadSubmitted,
} from './uploads-slice';

const PARALLEL_UPLOADS = 3;

type UploadImagesArgs = { files: readonly File[]; presets: readonly ImagePreset[] };

function problemOf(error: AppError): { problem: UploadProblem; detail: string | null } {
  switch (error.kind) {
    case 'unauthorized':
      return { problem: 'unauthorized', detail: null };
    case 'http':
      return { problem: 'rejected', detail: error.message };
    default:
      return { problem: 'network', detail: null };
  }
}

export const uploadImages = createAsyncThunk(
  'uploads/uploadImages',
  async ({ files, presets }: UploadImagesArgs, { dispatch, signal }) => {
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
      try {
        const ticket = await requestUpload(file, signal);
        await putToStorage(
          ticket.uploadUrl,
          file,
          (progress) => dispatch(uploadProgressed({ id, progress })),
          signal,
        );
        dispatch(uploadStored(id));
        const { jobId } = await createResizeJob(ticket.sourceKey, presets, signal);
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
