import { jpegSize } from './jpeg-size';

/** SOI, an APP0 segment to skip, then SOF0 for 640x360. */
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x68, 0x02,
  0x80, 0x03,
]);

describe('jpegSize', () => {
  it('reads the size from the frame header after other segments', () => {
    expect(jpegSize(jpeg)).toEqual({ width: 640, height: 360 });
  });

  it('rejects data that is not a JPEG', () => {
    expect(() => jpegSize(Buffer.from('GIF89a'))).toThrow('not a JPEG');
  });

  it('rejects a JPEG without a frame header', () => {
    expect(() => jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x00]))).toThrow();
  });
});
