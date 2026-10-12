/** Mirrors the gateway limits, so obvious mistakes fail before any network call. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const ACCEPTED_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES] as const;
export type AcceptedType = (typeof ACCEPTED_TYPES)[number];
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;

export type MediaKind = 'image' | 'video';
export type FileProblem = 'type' | 'size' | 'empty';

const isAccepted = (type: string): type is AcceptedType =>
  ACCEPTED_TYPES.some((accepted) => accepted === type);

export function mediaKindOf(type: string): MediaKind | null {
  if (!isAccepted(type)) return null;
  return VIDEO_TYPES.some((video) => video === type) ? 'video' : 'image';
}

export function checkFile(file: Pick<File, 'type' | 'size'>): FileProblem | null {
  const kind = mediaKindOf(file.type);
  if (!kind) return 'type';
  if (file.size === 0) return 'empty';
  if (file.size > (kind === 'video' ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES)) return 'size';
  return null;
}
