import { checkFile, MAX_UPLOAD_BYTES } from './validate-file';

describe('checkFile', () => {
  it('accepts supported images within the limit', () => {
    expect(checkFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(checkFile({ type: 'image/webp', size: MAX_UPLOAD_BYTES })).toBeNull();
  });

  it('rejects other types', () => {
    expect(checkFile({ type: 'image/gif', size: 1000 })).toBe('type');
    expect(checkFile({ type: '', size: 1000 })).toBe('type');
  });

  it('rejects empty and oversized files', () => {
    expect(checkFile({ type: 'image/jpeg', size: 0 })).toBe('empty');
    expect(checkFile({ type: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1 })).toBe('size');
  });
});
