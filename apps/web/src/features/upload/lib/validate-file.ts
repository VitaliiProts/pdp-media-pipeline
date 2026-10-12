/** Mirrors the gateway limits, so obvious mistakes fail before any network call. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AcceptedType = (typeof ACCEPTED_TYPES)[number];
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type FileProblem = 'type' | 'size' | 'empty';

const isAccepted = (type: string): type is AcceptedType =>
  ACCEPTED_TYPES.some((accepted) => accepted === type);

export function checkFile(file: Pick<File, 'type' | 'size'>): FileProblem | null {
  if (!isAccepted(file.type)) return 'type';
  if (file.size === 0) return 'empty';
  if (file.size > MAX_UPLOAD_BYTES) return 'size';
  return null;
}
