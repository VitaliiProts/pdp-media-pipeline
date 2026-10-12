import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  CreateWebhookEndpointRequest,
  type ListWebhookEndpointsResponse,
  type WebhookEndpointDto,
  type WebhookEndpointWithSecretDto,
} from '@pdp/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WebhooksService } from './webhooks.service';

/** Internal API: reachable only inside the compose network / cluster, no auth. */
@Controller('internal/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateWebhookEndpointRequest)) body: CreateWebhookEndpointRequest,
  ): Promise<WebhookEndpointWithSecretDto> {
    return this.webhooks.create(body);
  }

  @Get()
  async list(
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<ListWebhookEndpointsResponse> {
    return { items: await this.webhooks.list(userId) };
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<WebhookEndpointWithSecretDto> {
    return this.webhooks.getWithSecret(id);
  }

  @Delete(':id')
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<WebhookEndpointDto> {
    return this.webhooks.delete(id, userId);
  }
}
