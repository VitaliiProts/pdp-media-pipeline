import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ASSET_NAME_MAX_LENGTH,
  UPLOAD_CONTENT_TYPES,
  type UploadContentType,
} from '@pdp/contracts';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateUploadDto {
  @ApiProperty({ enum: UPLOAD_CONTENT_TYPES })
  @IsIn(UPLOAD_CONTENT_TYPES)
  contentType!: UploadContentType;

  @ApiProperty({ description: 'Exact size in bytes; it is part of the signature.', minimum: 1 })
  @IsInt()
  @Min(1)
  size!: number;

  @ApiPropertyOptional({
    description: 'Original file name, shown and searched in the media library.',
    maxLength: ASSET_NAME_MAX_LENGTH,
    example: 'beach.jpg',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ASSET_NAME_MAX_LENGTH)
  name?: string;
}

export class UploadResponseDto {
  @ApiProperty({ description: 'PUT the file here with the declared Content-Type.' })
  uploadUrl!: string;

  @ApiProperty({ example: 'uploads/5b0c.../0f3e....png' })
  sourceKey!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Media library entry of the file; it is listed once a job uses it.',
  })
  assetId!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}
