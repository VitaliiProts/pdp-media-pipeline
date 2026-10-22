import { type ArgumentsHost } from '@nestjs/common';
import { MetadataError } from '@pdp/metadata-client';
import { METADATA_RETRY_AFTER_S, MetadataErrorFilter } from './metadata-error.filter';

function respond(error: MetadataError) {
  const res = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new MetadataErrorFilter().catch(error, host);
  return res;
}

describe('MetadataErrorFilter', () => {
  it.each([
    ['a timeout', 0],
    ['a 5xx', 502],
  ])('turns %s into 503 with Retry-After', (_, status) => {
    const res = respond(new MetadataError(status, undefined, 'metadata unreachable'));
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', String(METADATA_RETRY_AFTER_S));
  });

  it('passes a 4xx through with its code and no Retry-After', () => {
    const res = respond(new MetadataError(409, 'STORAGE_QUOTA_EXCEEDED', 'quota'));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'STORAGE_QUOTA_EXCEEDED' }),
    );
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
