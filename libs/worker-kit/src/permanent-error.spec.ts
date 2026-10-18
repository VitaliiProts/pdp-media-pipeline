import { isPermanentError, PermanentError } from './permanent-error';

describe('PermanentError', () => {
  it('leads its message with the code, which becomes the lastError the UI reads', () => {
    const err = new PermanentError('video is 75.0s, limit 60s', 'too_long');
    expect(err.code).toBe('too_long');
    expect(err.message).toBe('too_long: video is 75.0s, limit 60s');
    expect(isPermanentError(err)).toBe(true);
  });

  it('keeps the message as it is without a code', () => {
    const err = new PermanentError('no video stream');
    expect(err.code).toBeUndefined();
    expect(err.message).toBe('no video stream');
  });
});
