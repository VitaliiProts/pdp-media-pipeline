import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEAD_REASONS,
  type DeadReason,
  DUB_TARGET_LANGUAGES,
  DUB_VOICES,
  type DubTargetLanguage,
  IMAGE_PRESET_NAMES,
  type ImagePreset,
  JOB_STATUSES,
  type JobStatus,
  type Rendition,
  RENDITION_NAMES,
  SOURCE_URL_MAX_LENGTH,
  VIDEO_CODECS,
} from '@pdp/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const CREATABLE_JOB_TYPES = [
  'image.resize',
  'video.frames',
  'video.transcode',
  'video.dub',
] as const;
export type CreatableJobType = (typeof CREATABLE_JOB_TYPES)[number];

/** Exactly one of `sourceKey` and `sourceUrl`; the rest depends on `type`. */
export class CreateJobDto {
  @ApiProperty({ enum: CREATABLE_JOB_TYPES })
  @IsIn(CREATABLE_JOB_TYPES)
  type!: CreatableJobType;

  @ApiPropertyOptional({ description: 'Key returned by POST /v1/uploads.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  sourceKey?: string;

  @ApiPropertyOptional({
    description: 'Public http(s) URL to fetch the source from; private addresses are rejected.',
    maxLength: SOURCE_URL_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(SOURCE_URL_MAX_LENGTH)
  sourceUrl?: string;

  @ApiPropertyOptional({
    enum: IMAGE_PRESET_NAMES,
    isArray: true,
    description: 'Required for image.resize.',
  })
  @ValidateIf((dto: CreateJobDto) => dto.type === 'image.resize')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(IMAGE_PRESET_NAMES, { each: true })
  presets?: ImagePreset[];

  @ApiPropertyOptional({ minimum: 0.5, maximum: 30, default: 2, description: 'video.frames' })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(30)
  intervalSeconds?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 60, default: 10, description: 'video.frames' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  maxFrames?: number;

  @ApiPropertyOptional({
    enum: RENDITION_NAMES,
    isArray: true,
    default: RENDITION_NAMES,
    description: 'video.transcode; renditions larger than the source are skipped.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(RENDITION_NAMES, { each: true })
  renditions?: Rendition[];

  @ApiPropertyOptional({ enum: DUB_TARGET_LANGUAGES, description: 'Required for video.dub.' })
  @ValidateIf((dto: CreateJobDto) => dto.type === 'video.dub')
  @IsIn(DUB_TARGET_LANGUAGES)
  targetLanguage?: DubTargetLanguage;

  @ApiPropertyOptional({
    default: 'auto',
    description: 'video.dub: ISO 639-1 code of the speech, or auto to detect it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  sourceLanguage?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        gender: { type: 'string', enum: ['male', 'female'] },
        voice: { type: 'string', enum: [...DUB_VOICES] },
      },
    },
    description: 'video.dub: gender or voice by speaker id of a previous dub (with reuseOf).',
  })
  @IsOptional()
  @IsObject()
  speakers?: Record<string, unknown>;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'video.dub: a previous dub of the same file; its recognition is reused.',
  })
  @IsOptional()
  @IsUUID()
  reuseOf?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 9, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  priority?: number;
}

export class CreateJobResponseDto {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({ enum: JOB_STATUSES })
  status!: JobStatus;
}

export class ListJobsQueryDto {
  @ApiPropertyOptional({ enum: JOB_STATUSES })
  @IsOptional()
  @IsIn(JOB_STATUSES)
  status?: JobStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only jobs on this media library file.' })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class JobResultDto {
  @ApiProperty({ enum: IMAGE_PRESET_NAMES })
  preset!: ImagePreset;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty()
  bytes!: number;

  @ApiProperty({ description: 'Presigned GET URL, valid for at least one hour.' })
  url!: string;

  @ApiPropertyOptional({
    description: 'Presigned GET URL that saves the file under a readable name. Asset details only.',
  })
  downloadUrl?: string;
}

export class VideoFrameDto {
  @ApiProperty({ description: 'Position in the video.' })
  atSeconds!: number;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty()
  bytes!: number;

  @ApiProperty({ description: 'Presigned GET URL, valid for at least one hour.' })
  url!: string;

  @ApiPropertyOptional({
    description: 'Presigned GET URL that saves the file under a readable name. Asset details only.',
  })
  downloadUrl?: string;
}

export class VideoResultDto {
  @ApiProperty()
  durationSeconds!: number;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty({ enum: VIDEO_CODECS })
  codec!: string;

  @ApiProperty({ type: VideoFrameDto })
  preview!: VideoFrameDto;

  @ApiProperty({ type: [VideoFrameDto] })
  frames!: VideoFrameDto[];
}

export class RenditionDto {
  @ApiProperty({ enum: RENDITION_NAMES })
  rendition!: Rendition;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty()
  durationSeconds!: number;

  @ApiProperty()
  bytes!: number;

  @ApiProperty({ description: 'Of the whole file, in bits per second.' })
  bitrate!: number;

  @ApiProperty({ description: 'Presigned GET URL of the MP4, valid for at least one hour.' })
  url!: string;

  @ApiPropertyOptional({
    description: 'Presigned GET URL that saves the file under a readable name. Asset details only.',
  })
  downloadUrl?: string;
}

export class TranscodeResultDto {
  @ApiProperty()
  durationSeconds!: number;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty({ enum: VIDEO_CODECS })
  codec!: string;

  @ApiProperty({ type: VideoFrameDto })
  preview!: VideoFrameDto;

  @ApiProperty({ type: [RenditionDto] })
  renditions!: RenditionDto[];

  @ApiProperty({
    enum: RENDITION_NAMES,
    isArray: true,
    description: 'Requested but larger than the source; videos are not upscaled.',
  })
  skipped!: Rendition[];
}

export class JobResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ enum: JOB_STATUSES })
  status!: JobStatus;

  @ApiProperty()
  priority!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  input!: Record<string, unknown>;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Media library file the job reads; null for sourceUrl jobs.',
  })
  assetId!: string | null;

  @ApiProperty()
  attempts!: number;

  @ApiProperty({ type: String, nullable: true })
  lastError!: string | null;

  @ApiProperty({
    enum: DEAD_REASONS,
    nullable: true,
    description: 'Why a dead job stopped: the input is unusable, or every attempt failed.',
  })
  deadReason!: DeadReason | null;

  @ApiProperty({ type: [JobResultDto], required: false, description: 'image.resize' })
  results?: JobResultDto[];

  @ApiProperty({ type: VideoResultDto, required: false, description: 'video.frames' })
  video?: VideoResultDto;

  @ApiProperty({ type: TranscodeResultDto, required: false, description: 'video.transcode' })
  transcode?: TranscodeResultDto;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 100,
    description: 'Percent done while running, for job types that report it (video.transcode).',
  })
  progress!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'align',
    description:
      'Step of the work while running, for job types made of several (video.dub: extract, separate, align, translate, voice, mix).',
  })
  progressStep!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ format: 'date-time', type: String, nullable: true })
  finishedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'W3C trace id of the request that created or last redrove the job.',
  })
  traceId!: string | null;
}

export class ListJobsResponseDto {
  @ApiProperty({ type: [JobResponseDto] })
  items!: JobResponseDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
