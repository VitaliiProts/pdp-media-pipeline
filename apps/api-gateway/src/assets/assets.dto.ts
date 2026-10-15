import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ASSET_KINDS,
  ASSET_SEARCH_MAX_LENGTH,
  ASSET_STATUSES,
  type AssetKind,
  type AssetStatus,
  JOB_STATUSES,
  type JobStatus,
  UPLOAD_CONTENT_TYPES,
  type UploadContentType,
} from '@pdp/contracts';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { JobResponseDto } from '../jobs/jobs.dto';

export class ListAssetsQueryDto {
  @ApiPropertyOptional({ enum: ASSET_KINDS, description: 'Photos or videos only.' })
  @IsOptional()
  @IsIn(ASSET_KINDS)
  kind?: AssetKind;

  @ApiPropertyOptional({
    enum: ASSET_STATUSES,
    description: 'What the latest job says: processing, ready or failed.',
  })
  @IsOptional()
  @IsIn(ASSET_STATUSES)
  status?: AssetStatus;

  @ApiPropertyOptional({
    maxLength: ASSET_SEARCH_MAX_LENGTH,
    description: 'Part of the file name, case-insensitive.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(ASSET_SEARCH_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class AssetPreviewDto {
  @ApiProperty({ description: 'Presigned GET URL, valid for one hour.' })
  url!: string;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;
}

export class AssetLatestJobDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ enum: JOB_STATUSES })
  status!: JobStatus;
}

export class AssetDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ASSET_KINDS })
  kind!: AssetKind;

  @ApiProperty({ type: String, nullable: true, description: 'File name sent with the upload.' })
  name!: string | null;

  @ApiProperty({ enum: UPLOAD_CONTENT_TYPES })
  contentType!: UploadContentType;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Bytes; null for files uploaded before the media library.',
  })
  size!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Known once a job read the file.' })
  width!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Videos only.' })
  durationSeconds!: number | null;

  @ApiProperty({ description: 'Pass as sourceKey to POST /v1/jobs to process the file again.' })
  sourceKey!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AssetSummaryDto extends AssetDto {
  @ApiProperty({
    type: AssetPreviewDto,
    nullable: true,
    description: 'Thumbnail of a photo or preview frame of a video, once a job produced one.',
  })
  preview!: AssetPreviewDto | null;

  @ApiProperty({ type: AssetLatestJobDto, nullable: true })
  latestJob!: AssetLatestJobDto | null;
}

export class ListAssetsResponseDto {
  @ApiProperty({ type: [AssetSummaryDto] })
  items!: AssetSummaryDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class AssetDetailsDto extends AssetDto {
  @ApiProperty({ description: 'Presigned GET URL of the original, valid for one hour.' })
  originalUrl!: string;

  @ApiProperty({
    description:
      'Presigned GET URL that saves the original under its uploaded name, valid for one hour.',
  })
  originalDownloadUrl!: string;

  @ApiProperty({
    type: [JobResponseDto],
    description: 'Newest jobs on the file with presigned result URLs.',
  })
  jobs!: JobResponseDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Older jobs: GET /v1/jobs?assetId={id}&cursor={jobsNextCursor}.',
  })
  jobsNextCursor!: string | null;
}
