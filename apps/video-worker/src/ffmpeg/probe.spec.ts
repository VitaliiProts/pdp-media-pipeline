import { isPermanentError } from '@pdp/worker-kit';
import { parseProbe } from './probe';

const limits = { maxDurationSeconds: 60, maxDimension: 8192 };

const probe = (stream: Record<string, unknown>, format: Record<string, unknown> = {}) =>
  JSON.stringify({ streams: [{ codec_type: 'video', ...stream }], format });

function rejection(stdout: string): Error {
  try {
    parseProbe(stdout, limits);
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected parseProbe to throw');
}

describe('parseProbe', () => {
  it('reads codec, size and duration', () => {
    expect(
      parseProbe(probe({ codec_name: 'h264', width: 320, height: 240, duration: '5.000' }), limits),
    ).toEqual({ codec: 'h264', width: 320, height: 240, durationSeconds: 5 });
  });

  it.each([
    ['display matrix', { side_data_list: [{ rotation: -90 }] }],
    ['rotate tag', { tags: { rotate: '270' } }],
  ])('reports the displayed size of a rotated video (%s)', (_, rotation) => {
    const result = parseProbe(
      probe({ codec_name: 'h264', width: 1920, height: 1080, duration: '3', ...rotation }),
      limits,
    );
    expect(result).toMatchObject({ width: 1080, height: 1920 });
  });

  it('falls back to the container duration', () => {
    const result = parseProbe(
      probe({ codec_name: 'vp9', width: 640, height: 360 }, { duration: '12.5' }),
      limits,
    );
    expect(result.durationSeconds).toBe(12.5);
  });

  it.each([
    ['not json', 'unreadable output'],
    [JSON.stringify({ streams: [] }), 'no video stream'],
    [probe({ codec_name: 'prores', width: 10, height: 10, duration: '1' }), 'prores'],
    [probe({ codec_name: 'h264', duration: '1' }), 'no frame size'],
    [probe({ codec_name: 'h264', width: 10000, height: 10, duration: '1' }), 'exceeds'],
    [probe({ codec_name: 'h264', width: 10, height: 10 }), 'duration is unknown'],
    [probe({ codec_name: 'h264', width: 10, height: 10, duration: '61' }), 'limit 60s'],
  ])('rejects %s permanently', (stdout, message) => {
    const err = rejection(stdout);
    expect(isPermanentError(err)).toBe(true);
    expect(err.message).toContain(message);
  });
});
