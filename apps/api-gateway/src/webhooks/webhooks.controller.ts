import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import {
  type JobDto,
  WEBHOOK_EVENTS,
  WEBHOOK_MAX_ENDPOINTS_PER_USER,
  WebhookDeliverInputV1,
  WebhookDeliverOutputV1,
  type WebhookEndpointDto,
} from '@pdp/contracts';
import { EgressClient } from '@pdp/egress';
import { MetadataClient } from '@pdp/metadata-client';
import { AuthGuard } from '../auth/auth.guard';
import { UserId } from '../auth/user';
import { assertPublicUrl } from '../common/public-url';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import {
  CreatedWebhookDto,
  CreateWebhookDto,
  type DeliveryDto,
  ListDeliveriesQueryDto,
  ListDeliveriesResponseDto,
  ListWebhooksResponseDto,
  type WebhookDto,
} from './webhooks.dto';

const toDto = ({ id, url, events, createdAt }: WebhookEndpointDto): WebhookDto => ({
  id,
  url,
  events,
  createdAt,
});

@ApiTags('webhooks')
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded, see Retry-After' })
@UseGuards(AuthGuard, RateLimitGuard)
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly egress: EgressClient,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: CreatedWebhookDto })
  @ApiConflictResponse({
    description: `At most ${WEBHOOK_MAX_ENDPOINTS_PER_USER} endpoints per user`,
  })
  async create(
    @UserId() userId: string,
    @Body() body: CreateWebhookDto,
  ): Promise<CreatedWebhookDto> {
    await assertPublicUrl(this.egress, body.url, 'url');
    const endpoint = await this.metadata.createWebhookEndpoint({
      userId,
      url: body.url,
      events: body.events ?? [...WEBHOOK_EVENTS],
    });
    return { ...toDto(endpoint), secret: endpoint.secret };
  }

  @Get()
  @ApiOkResponse({ type: ListWebhooksResponseDto })
  async list(@UserId() userId: string): Promise<ListWebhooksResponseDto> {
    const { items } = await this.metadata.listWebhookEndpoints(userId);
    return { items: items.map(toDto) };
  }

  /** Queued deliveries to a deleted endpoint end as dead instead of being sent. */
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async delete(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.metadata.deleteWebhookEndpoint(id, userId);
  }

  @Get(':id/deliveries')
  @ApiOkResponse({ type: ListDeliveriesResponseDto })
  async deliveries(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListDeliveriesQueryDto,
  ): Promise<ListDeliveriesResponseDto> {
    const { items } = await this.metadata.listWebhookEndpoints(userId);
    if (!items.some((endpoint) => endpoint.id === id)) {
      throw new NotFoundException(`webhook ${id} not found`);
    }
    const page = await this.metadata.listJobs({
      userId,
      types: ['webhook.deliver'],
      webhookEndpointId: id,
      ...query,
    });
    return {
      items: page.items.flatMap((job) => toDelivery(job) ?? []),
      nextCursor: page.nextCursor,
    };
  }
}

function toDelivery(job: JobDto): DeliveryDto | null {
  const input = WebhookDeliverInputV1.safeParse(job.input);
  if (!input.success) return null;
  const output = WebhookDeliverOutputV1.safeParse(job.output);
  return {
    id: job.id,
    messageId: input.data.messageId,
    event: input.data.payload.type,
    jobId: input.data.payload.data.jobId,
    status: job.status,
    attempts: job.attempts,
    responseStatus: output.success ? output.data.statusCode : null,
    lastError: job.lastError,
    deadReason: job.deadReason,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
