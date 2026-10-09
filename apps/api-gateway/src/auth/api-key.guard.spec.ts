import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { hashApiKey } from '@pdp/contracts';
import { type MetadataClient, MetadataError } from '@pdp/metadata-client';
import { type Env } from '../config';
import { ApiKeyGuard } from './api-key.guard';

const USER_ID = '5b0c5a8e-0000-4000-8000-000000000001';

function context(headers: Record<string, string>) {
  const req: { userId?: string; header: (name: string) => string | undefined } = {
    header: (name) => headers[name.toLowerCase()],
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { req, ctx };
}

function setup(ttlMs = 60_000) {
  const resolveApiKey = jest.fn<Promise<string | null>, [string]>();
  const metadata = { resolveApiKey } as unknown as MetadataClient;
  const config = { get: () => ttlMs } as unknown as ConfigService<Env, true>;
  return { resolveApiKey, guard: new ApiKeyGuard(metadata, config) };
}

describe('ApiKeyGuard', () => {
  it('rejects requests without a key', async () => {
    const { guard, resolveApiKey } = setup();
    await expect(guard.canActivate(context({}).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  it('sends only the hash and attaches the user id', async () => {
    const { guard, resolveApiKey } = setup();
    resolveApiKey.mockResolvedValue(USER_ID);
    const { req, ctx } = context({ 'x-api-key': 'pdp_secret' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolveApiKey).toHaveBeenCalledWith(hashApiKey('pdp_secret'));
    expect(req.userId).toBe(USER_ID);
  });

  it('rejects unknown keys', async () => {
    const { guard, resolveApiKey } = setup();
    resolveApiKey.mockResolvedValue(null);
    await expect(guard.canActivate(context({ 'x-api-key': 'nope' }).ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('caches resolved keys within the ttl', async () => {
    const { guard, resolveApiKey } = setup();
    resolveApiKey.mockResolvedValue(USER_ID);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    expect(resolveApiKey).toHaveBeenCalledTimes(1);
  });

  it('resolves again after the ttl', async () => {
    const { guard, resolveApiKey } = setup(0);
    resolveApiKey.mockResolvedValue(USER_ID);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    expect(resolveApiKey).toHaveBeenCalledTimes(2);
  });

  it('propagates metadata outages instead of answering 401', async () => {
    const { guard, resolveApiKey } = setup();
    resolveApiKey.mockRejectedValue(new MetadataError(0, undefined, 'timeout'));
    await expect(guard.canActivate(context({ 'x-api-key': 'k' }).ctx)).rejects.toBeInstanceOf(
      MetadataError,
    );
  });
});
