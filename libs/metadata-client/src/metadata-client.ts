import {
  type CreateJobRequest,
  CreateJobResponse,
  JobDto,
  ListJobsResponse,
  type ListJobsQuery,
  MetadataErrorBody,
  type MetadataErrorCode,
  type ProgressRequest,
  type RedriveRequest,
  ResolveApiKeyResponse,
  type TransitionRequest,
  TransitionResponse,
  type CreateWebhookEndpointRequest,
  ListWebhookEndpointsResponse,
  WebhookEndpointDto,
  WebhookEndpointWithSecretDto,
} from '@pdp/contracts';
import { z } from 'zod';

export interface MetadataClientOptions {
  baseUrl: string;
  timeoutMs: number;
}

/**
 * `status` 0 means the request never got a response (network error, timeout):
 * callers treat it like a 5xx and retry later.
 */
export class MetadataError extends Error {
  constructor(
    readonly status: number,
    readonly code: MetadataErrorCode | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'MetadataError';
  }

  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export class MetadataClient {
  constructor(private readonly options: MetadataClientOptions) {}

  createJob(body: CreateJobRequest): Promise<CreateJobResponse> {
    return this.request('POST', '/internal/jobs', CreateJobResponse, body);
  }

  redrive(id: string, body: RedriveRequest): Promise<JobDto> {
    return this.request('POST', `/internal/jobs/${encodeURIComponent(id)}/redrive`, JobDto, body);
  }

  getJob(id: string): Promise<JobDto> {
    return this.request('GET', `/internal/jobs/${encodeURIComponent(id)}`, JobDto);
  }

  listJobs(query: ListJobsQuery): Promise<ListJobsResponse> {
    const params = new URLSearchParams();
    params.set('userId', query.userId);
    if (query.status) params.set('status', query.status);
    if (query.types) params.set('types', query.types.join(','));
    if (query.webhookEndpointId) params.set('webhookEndpointId', query.webhookEndpointId);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    return this.request('GET', `/internal/jobs?${params.toString()}`, ListJobsResponse);
  }

  transition(id: string, body: TransitionRequest): Promise<TransitionResponse> {
    return this.request(
      'POST',
      `/internal/jobs/${encodeURIComponent(id)}/transitions`,
      TransitionResponse,
      body,
    );
  }

  async reportProgress(id: string, body: ProgressRequest): Promise<void> {
    await this.request(
      'POST',
      `/internal/jobs/${encodeURIComponent(id)}/progress`,
      z.unknown(),
      body,
    );
  }

  createWebhookEndpoint(body: CreateWebhookEndpointRequest): Promise<WebhookEndpointWithSecretDto> {
    return this.request('POST', '/internal/webhooks', WebhookEndpointWithSecretDto, body);
  }

  listWebhookEndpoints(userId: string): Promise<ListWebhookEndpointsResponse> {
    const params = new URLSearchParams({ userId });
    return this.request(
      'GET',
      `/internal/webhooks?${params.toString()}`,
      ListWebhookEndpointsResponse,
    );
  }

  /** Includes the signing secret; for the delivering worker only. */
  getWebhookEndpoint(id: string): Promise<WebhookEndpointWithSecretDto> {
    return this.request(
      'GET',
      `/internal/webhooks/${encodeURIComponent(id)}`,
      WebhookEndpointWithSecretDto,
    );
  }

  deleteWebhookEndpoint(id: string, userId: string): Promise<WebhookEndpointDto> {
    const params = new URLSearchParams({ userId });
    return this.request(
      'DELETE',
      `/internal/webhooks/${encodeURIComponent(id)}?${params.toString()}`,
      WebhookEndpointDto,
    );
  }

  async resolveApiKey(apiKeyHash: string): Promise<string | null> {
    try {
      const res = await this.request('POST', '/internal/auth/resolve', ResolveApiKeyResponse, {
        apiKeyHash,
      });
      return res.userId;
    } catch (err) {
      if (err instanceof MetadataError && err.code === 'API_KEY_NOT_FOUND') return null;
      throw err;
    }
  }

  private async request<S extends z.ZodType>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.infer<S>> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.options.baseUrl), {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      throw new MetadataError(0, undefined, `metadata unreachable: ${(err as Error).message}`);
    }

    const payload: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const parsed = MetadataErrorBody.safeParse(payload);
      throw new MetadataError(
        res.status,
        parsed.success ? parsed.data.code : undefined,
        parsed.success ? parsed.data.message : `metadata responded ${res.status}`,
      );
    }
    return schema.parse(payload);
  }
}
