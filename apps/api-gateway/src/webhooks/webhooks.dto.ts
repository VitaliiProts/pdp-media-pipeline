import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEAD_REASONS,
  type DeadReason,
  JOB_STATUSES,
  type JobStatus,
  SOURCE_URL_MAX_LENGTH,
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from '@pdp/contracts';
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

export class CreateWebhookDto {
  @ApiProperty({ description: 'http(s) URL that receives POST requests; must be public.' })
  @IsString()
  @MaxLength(SOURCE_URL_MAX_LENGTH)
  url!: string;

  @ApiPropertyOptional({ enum: WEBHOOK_EVENTS, isArray: true, default: WEBHOOK_EVENTS })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events?: WebhookEvent[];
}

export class WebhookDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty({ enum: WEBHOOK_EVENTS, isArray: true })
  events!: WebhookEvent[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CreatedWebhookDto extends WebhookDto {
  @ApiProperty({
    description:
      'Signing secret (Standard Webhooks, whsec_…). Shown only once; store it to verify deliveries.',
  })
  secret!: string;
}

export class ListWebhooksResponseDto {
  @ApiProperty({ type: [WebhookDto] })
  items!: WebhookDto[];
}

export class ListDeliveriesQueryDto {
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

export class DeliveryDto {
  @ApiProperty({ format: 'uuid', description: 'Job id; redrive a dead delivery with it.' })
  id!: string;

  @ApiProperty({ description: 'Sent as webhook-id; the same on every attempt.' })
  messageId!: string;

  @ApiProperty({ enum: WEBHOOK_EVENTS })
  event!: WebhookEvent;

  @ApiProperty({ format: 'uuid', description: 'The job this delivery reports on.' })
  jobId!: string;

  @ApiProperty({ enum: JOB_STATUSES })
  status!: JobStatus;

  @ApiProperty()
  attempts!: number;

  @ApiProperty({ type: Number, nullable: true, description: 'Of the successful attempt.' })
  responseStatus!: number | null;

  @ApiProperty({ type: String, nullable: true })
  lastError!: string | null;

  @ApiProperty({ enum: DEAD_REASONS, nullable: true })
  deadReason!: DeadReason | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ListDeliveriesResponseDto {
  @ApiProperty({ type: [DeliveryDto] })
  items!: DeliveryDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
