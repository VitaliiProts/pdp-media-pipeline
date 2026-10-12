import { http, storageHttp } from '../../../shared/api/http';
import { type ImagePreset } from '../model/presets';

type UploadTicket = { uploadUrl: string; sourceKey: string };
type CreatedJob = { jobId: string };

export async function requestUpload(file: File, signal: AbortSignal): Promise<UploadTicket> {
  const { data } = await http.post<UploadTicket>(
    '/v1/uploads',
    { contentType: file.type, size: file.size },
    { signal },
  );
  return data;
}

/** The URL is signed for this exact type and size; the browser sets Content-Length itself. */
export async function putToStorage(
  uploadUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  await storageHttp.put(uploadUrl, file, {
    headers: { 'Content-Type': file.type },
    onUploadProgress: (event) => onProgress(event.total ? event.loaded / event.total : 0),
    signal,
  });
}

/**
 * `idempotencyKey` stays the same for every retry of one upload, so a retry after a lost
 * response returns the job already created instead of making a second one.
 */
export async function createResizeJob(
  sourceKey: string,
  presets: readonly ImagePreset[],
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<CreatedJob> {
  const { data } = await http.post<CreatedJob>(
    '/v1/jobs',
    { type: 'image.resize', sourceKey, presets },
    { headers: { 'Idempotency-Key': idempotencyKey }, signal },
  );
  return data;
}
