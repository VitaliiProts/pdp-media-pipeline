/** Start-of-frame markers carry the size; C4, C8 and CC share the range but are not SOF. */
const isStartOfFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/** Reads width and height from a JPEG header without decoding it. */
export function jpegSize(data: Buffer): { width: number; height: number } {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw new Error('not a JPEG');
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) throw new Error('corrupt JPEG marker');
    const marker = data[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    if (isStartOfFrame(marker)) {
      if (offset + 9 > data.length) break;
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('JPEG has no frame header');
}
