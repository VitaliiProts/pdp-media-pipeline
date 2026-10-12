import { BadRequestException, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EgressClient, EgressError } from '@pdp/egress';
import { type Env } from '../config';

/**
 * Fails fast on URLs that the workers would refuse anyway. Workers check again when they
 * connect, because what a host name resolves to can change in between.
 */
export async function assertPublicUrl(
  egress: EgressClient,
  url: string,
  field: string,
): Promise<void> {
  try {
    await egress.check(url);
  } catch (err) {
    if (err instanceof EgressError) throw new BadRequestException(`${field}: ${err.message}`);
    throw err;
  }
}

export const egressClientProvider: Provider = {
  provide: EgressClient,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) =>
    new EgressClient({
      timeoutMs: config.get('EGRESS_TIMEOUT_MS', { infer: true }),
      perHostConcurrency: config.get('EGRESS_PER_HOST_CONCURRENCY', { infer: true }),
      privateHosts: config.get('EGRESS_PRIVATE_HOSTS', { infer: true }),
      maxBytes: 0,
      userAgent: 'pdp-api-gateway',
    }),
};
