import { z } from 'zod';
import { ImageResizeOutputV1 } from './image-resize';
import { type JobType, JobStatusSchema, JobTypeSchema } from './jobs';
import { JobProgressSchema } from './metadata-api';
import { VideoFramesOutputV1 } from './video-frames';
import { VideoTranscodeOutputV1 } from './video-transcode';

export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const UPLOAD_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES] as const;
export const UploadContentTypeSchema = z.enum(UPLOAD_CONTENT_TYPES);
export type UploadContentType = z.infer<typeof UploadContentTypeSchema>;

export const ASSET_KINDS = ['image', 'video'] as const;
export const AssetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/** What the latest job on a file says about it; see the Metadata list query. */
export const ASSET_STATUSES = ['processing', 'ready', 'failed'] as const;
export const AssetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

export const ASSET_SEARCH_MAX_LENGTH = 100;

export const assetKindOf = (contentType: UploadContentType): AssetKind =>
  (VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType) ? 'video' : 'image';

/** Every result key of a job starts with this, whatever the job type. */
export const jobResultsPrefix = (jobId: string): string => `results/${jobId}/`;

export const ASSET_NAME_MAX_LENGTH = 255;
/** Jobs listed with an asset; the rest of its history is under `GET /v1/jobs?assetId=`. */
export const ASSET_DETAIL_JOBS = 50;

export const AssetDto = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  /** The original in object storage; also the `sourceKey` for new jobs on this asset. */
  key: z.string(),
  kind: AssetKindSchema,
  /** File name the client sent with the upload, for display and search. */
  name: z.string().nullable(),
  contentType: UploadContentTypeSchema,
  /** Null only for files uploaded before the media library, whose size was never recorded. */
  size: z.number().int().min(0).nullable(),
  /** Known once a job has read the original. */
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationSeconds: z.number().positive().nullable(),
  createdAt: z.iso.datetime(),
});
export type AssetDto = z.infer<typeof AssetDto>;

export const AssetPreview = z.object({
  key: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type AssetPreview = z.infer<typeof AssetPreview>;

export const AssetSummaryDto = AssetDto.extend({
  /** From the newest succeeded job that produced a small image of the file. */
  preview: AssetPreview.nullable(),
  latestJob: z
    .object({
      id: z.uuid(),
      type: JobTypeSchema,
      status: JobStatusSchema,
      /** Percent while `running`, for job types that report it; null otherwise. */
      progress: JobProgressSchema.nullable(),
    })
    .nullable(),
});
export type AssetSummaryDto = z.infer<typeof AssetSummaryDto>;

export const CreateAssetRequest = z.object({
  userId: z.uuid(),
  key: z.string().min(1).max(512),
  contentType: UploadContentTypeSchema,
  size: z.number().int().positive(),
  name: z.string().trim().min(1).max(ASSET_NAME_MAX_LENGTH).optional(),
});
export type CreateAssetRequest = z.infer<typeof CreateAssetRequest>;

export const ListAssetsQuery = z.object({
  userId: z.uuid(),
  kind: AssetKindSchema.optional(),
  status: AssetStatusSchema.optional(),
  q: z
    .string()
    .trim()
    .max(ASSET_SEARCH_MAX_LENGTH)
    .transform((value) => value || undefined)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
/** Caller-side shape; the schema also coerces query-string values on the server. */
export type ListAssetsQuery = Omit<z.output<typeof ListAssetsQuery>, 'limit'> & { limit?: number };

export const ListAssetsResponse = z.object({
  items: z.array(AssetSummaryDto),
  nextCursor: z.string().nullable(),
});
export type ListAssetsResponse = z.infer<typeof ListAssetsResponse>;

/**
 * The newest preview-producing output of a job: the smallest resized image, or the frame
 * a video job extracts for that purpose.
 */
export function previewOf(type: JobType, output: unknown): AssetPreview | null {
  if (type === 'image.resize') {
    const parsed = ImageResizeOutputV1.safeParse(output);
    if (!parsed.success) return null;
    const [smallest] = [...parsed.data.results].sort((a, b) => a.width - b.width);
    if (!smallest) return null;
    return { key: smallest.key, width: smallest.width, height: smallest.height };
  }
  if (type === 'video.frames' || type === 'video.transcode') {
    const schema = type === 'video.frames' ? VideoFramesOutputV1 : VideoTranscodeOutputV1;
    const parsed = schema.safeParse(output);
    if (!parsed.success) return null;
    const { key, width, height } = parsed.data.preview;
    return { key, width, height };
  }
  return null;
}

export interface SourceFacts {
  width: number;
  height: number;
  durationSeconds: number | null;
}

/** What a succeeded job learned about its original. */
export function sourceFactsOf(type: JobType, output: unknown): SourceFacts | null {
  if (type === 'image.resize') {
    const parsed = ImageResizeOutputV1.safeParse(output);
    if (!parsed.success || !parsed.data.source) return null;
    return { ...parsed.data.source, durationSeconds: null };
  }
  if (type === 'video.frames' || type === 'video.transcode') {
    const schema = type === 'video.frames' ? VideoFramesOutputV1 : VideoTranscodeOutputV1;
    const parsed = schema.safeParse(output);
    if (!parsed.success) return null;
    const { width, height, durationSeconds } = parsed.data;
    return { width, height, durationSeconds };
  }
  return null;
}
