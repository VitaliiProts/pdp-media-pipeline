import { http, storageHttp } from '../../../shared/api/http';
import { type ImagePreset, type VideoMode } from '../model/presets';

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

/** Images are resized to the chosen presets; videos get frames or are transcoded. */
export type JobSpec =
  { kind: 'image'; presets: readonly ImagePreset[] } | { kind: 'video'; mode: VideoMode };

function bodyOf(sourceKey: string, spec: JobSpec) {
  if (spec.kind === 'image') return { type: 'image.resize', sourceKey, presets: spec.presets };
  return { type: spec.mode === 'frames' ? 'video.frames' : 'video.transcode', sourceKey };
}

/**
 * `idempotencyKey` stays the same for every retry of one upload, so a retry after a lost
 * response returns the job already created instead of making a second one.
 */
export async function createJob(
  sourceKey: string,
  spec: JobSpec,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<CreatedJob> {
  const { data } = await http.post<CreatedJob>('/v1/jobs', bodyOf(sourceKey, spec), {
    headers: { 'Idempotency-Key': idempotencyKey },
    signal,
  });
  return data;
}
