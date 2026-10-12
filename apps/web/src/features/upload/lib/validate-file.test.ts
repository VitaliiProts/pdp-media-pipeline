import { checkFile, MAX_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES, mediaKindOf } from './validate-file';

describe('checkFile', () => {
  it('accepts supported images within the limit', () => {
    expect(checkFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(checkFile({ type: 'image/webp', size: MAX_UPLOAD_BYTES })).toBeNull();
  });

  it('accepts videos up to their own, larger limit', () => {
    expect(checkFile({ type: 'video/mp4', size: MAX_UPLOAD_BYTES + 1 })).toBeNull();
    expect(checkFile({ type: 'video/webm', size: MAX_VIDEO_UPLOAD_BYTES + 1 })).toBe('size');
  });

  it('rejects other types', () => {
    expect(checkFile({ type: 'image/gif', size: 1000 })).toBe('type');
    expect(checkFile({ type: 'video/x-msvideo', size: 1000 })).toBe('type');
    expect(checkFile({ type: '', size: 1000 })).toBe('type');
  });

  it('rejects empty and oversized files', () => {
    expect(checkFile({ type: 'image/jpeg', size: 0 })).toBe('empty');
    expect(checkFile({ type: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1 })).toBe('size');
  });
});

describe('mediaKindOf', () => {
  it('tells images from videos', () => {
    expect(mediaKindOf('image/jpeg')).toBe('image');
    expect(mediaKindOf('video/quicktime')).toBe('video');
    expect(mediaKindOf('application/pdf')).toBeNull();
  });
});
