import { type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type egressEnvSchema } from '@pdp/config';
import { type MediaSource } from '@pdp/contracts';
import { classifyStatus, EgressClient } from '@pdp/egress';
import { traced } from '@pdp/observability';
import { createWriteStream } from 'node:fs';
import { type z } from 'zod';
import { ObjectStorage } from './object-storage';
import { PermanentError } from './permanent-error';

export interface FetchLimits {
  maxBytes: number;
  timeoutMs?: number;
}

/** Reads a job source from storage or over the network, with the same limits either way. */
export class SourceFetcher {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly egress: EgressClient,
  ) {}

  fetch(source: MediaSource, limits: FetchLimits): Promise<Buffer> {
    return traced('source fetch', { attributes: { 'source.kind': source.kind } }, async (span) => {
      const body =
        source.kind === 'key'
          ? await this.storage.getObject(source.key, limits.maxBytes)
          : await this.fetchUrl(source.url, limits);
      span.setAttribute('source.bytes', body.length);
      return body;
    });
  }

  /** Streams to disk; the span covers the whole transfer, not just the response headers. */
  download(source: MediaSource, path: string, limits: FetchLimits): Promise<void> {
    return traced(
      'source download',
      { attributes: { 'source.kind': source.kind } },
      async (span) => {
        if (source.kind === 'key') {
          span.setAttribute(
            'source.bytes',
            await this.storage.downloadToFile(source.key, path, limits.maxBytes),
          );
          return;
        }
        const res = await this.egress.request(source.url, {
          ...limits,
          sink: createWriteStream(path),
        });
        assertOk(res.status, source.url);
        span.setAttribute('source.bytes', res.bytes);
      },
    );
  }

  private async fetchUrl(url: string, limits: FetchLimits): Promise<Buffer> {
    const res = await this.egress.request(url, limits);
    assertOk(res.status, url);
    return res.body;
  }
}

function assertOk(status: number, url: string): void {
  const outcome = classifyStatus(status);
  if (outcome === 'success') return;
  const message = `source ${new URL(url).host} responded ${status}`;
  throw outcome === 'permanent' ? new PermanentError(message) : new Error(message);
}

type EgressEnv = z.infer<typeof egressEnvSchema>;

export const egressClientProvider = (userAgent: string): Provider => ({
  provide: EgressClient,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EgressEnv, true>) =>
    new EgressClient({
      timeoutMs: config.get('EGRESS_TIMEOUT_MS', { infer: true }),
      perHostConcurrency: config.get('EGRESS_PER_HOST_CONCURRENCY', { infer: true }),
      privateHosts: config.get('EGRESS_PRIVATE_HOSTS', { infer: true }),
      // Callers pass their own cap; this only bounds requests that forget to.
      maxBytes: 1024 * 1024,
      userAgent,
    }),
});

export const sourceFetcherProvider: Provider = {
  provide: SourceFetcher,
  inject: [ObjectStorage, EgressClient],
  useFactory: (storage: ObjectStorage, egress: EgressClient) => new SourceFetcher(storage, egress),
};
