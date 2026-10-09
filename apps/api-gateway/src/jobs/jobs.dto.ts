import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IMAGE_PRESET_NAMES, type ImagePreset, JOB_STATUSES, type JobStatus } from '@pdp/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateJobDto {
  @ApiProperty({ enum: ['image.resize'] })
  @IsIn(['image.resize'])
  type!: 'image.resize';

  @ApiProperty({ description: 'Key returned by POST /v1/uploads.' })
  @IsString()
  @MaxLength(512)
  sourceKey!: string;

  @ApiProperty({ enum: IMAGE_PRESET_NAMES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(IMAGE_PRESET_NAMES, { each: true })
  presets!: ImagePreset[];

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

  @ApiProperty({ description: 'Presigned GET URL, valid for one hour.' })
  url!: string;
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

  @ApiProperty()
  attempts!: number;

  @ApiProperty({ type: String, nullable: true })
  lastError!: string | null;

  @ApiProperty({ type: [JobResultDto], required: false })
  results?: JobResultDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ format: 'date-time', type: String, nullable: true })
  finishedAt!: string | null;
}

export class ListJobsResponseDto {
  @ApiProperty({ type: [JobResponseDto] })
  items!: JobResponseDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
