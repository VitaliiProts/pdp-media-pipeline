import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Min } from 'class-validator';

export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];

export class CreateUploadDto {
  @ApiProperty({ enum: UPLOAD_CONTENT_TYPES })
  @IsIn(UPLOAD_CONTENT_TYPES)
  contentType!: UploadContentType;

  @ApiProperty({ description: 'Exact size in bytes; it is part of the signature.', minimum: 1 })
  @IsInt()
  @Min(1)
  size!: number;
}

export class UploadResponseDto {
  @ApiProperty({ description: 'PUT the file here with the declared Content-Type.' })
  uploadUrl!: string;

  @ApiProperty({ example: 'uploads/5b0c.../0f3e....png' })
  sourceKey!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}
