import { PermanentError } from '@pdp/worker-kit';
import { planRenditions, ProgressParser, transcodeArgs } from './transcode';

const argAfter = (args: string[], flag: string, nth = 0) =>
  args.filter((_, i) => args[i - 1] === flag)[nth];

describe('planRenditions', () => {
  it('keeps every rendition a 1080p source is large enough for, smallest first', () => {
    expect(planRenditions({ width: 1920, height: 1080 }, ['720p', '480p'])).toEqual({
      targets: [
        { rendition: '480p', size: 480 },
        { rendition: '720p', size: 720 },
      ],
      skipped: [],
    });
  });

  it('skips renditions larger than the source instead of upscaling', () => {
    expect(planRenditions({ width: 854, height: 480 }, ['480p', '720p'])).toEqual({
      targets: [{ rendition: '480p', size: 480 }],
      skipped: ['720p'],
    });
  });

  it('decides by the shorter side, so portrait video gets the same renditions', () => {
    expect(planRenditions({ width: 1080, height: 1920 }, ['720p']).targets).toEqual([
      { rendition: '720p', size: 720 },
    ]);
  });

  it('fails permanently when the source is smaller than every rendition', () => {
    expect(() => planRenditions({ width: 640, height: 360 }, ['480p', '720p'])).toThrow(
      PermanentError,
    );
  });
});

describe('transcodeArgs', () => {
  const outputs = [
    { rendition: '480p' as const, size: 480, path: '/w/480p.mp4' },
    { rendition: '720p' as const, size: 720, path: '/w/720p.mp4' },
  ];

  it('decodes once and splits into one scaled stream per rendition', () => {
    const args = transcodeArgs('/w/source', outputs, true);
    expect(argAfter(args, '-i')).toBe('/w/source');
    expect(argAfter(args, '-filter_complex')).toBe(
      '[0:v]split=2[s0][s1];[s0]scale=-2:480[v0];[s1]scale=-2:720[v1]',
    );
    expect(args.filter((a) => a.endsWith('.mp4'))).toEqual(['/w/480p.mp4', '/w/720p.mp4']);
  });

  it('caps the bitrate of each rendition and writes streamable H.264 + AAC', () => {
    const args = transcodeArgs('/w/source', outputs, true);
    expect([argAfter(args, '-maxrate', 0), argAfter(args, '-maxrate', 1)]).toEqual([
      '1500k',
      '3000k',
    ]);
    expect(argAfter(args, '-bufsize', 1)).toBe('6000k');
    expect(argAfter(args, '-c:v')).toBe('libx264');
    expect(argAfter(args, '-preset')).toBe('veryfast');
    expect(argAfter(args, '-c:a')).toBe('aac');
    expect(argAfter(args, '-movflags')).toBe('+faststart');
    // Audio is mapped only if the source has it.
    expect(args.filter((a) => a === '0:a:0?')).toHaveLength(2);
  });

  it('reports progress on stdout', () => {
    expect(argAfter(transcodeArgs('/w/source', outputs, true), '-progress')).toBe('pipe:1');
  });

  it('scales the width of a portrait video and skips split for one rendition', () => {
    expect(argAfter(transcodeArgs('/w/source', [outputs[1]!], false), '-filter_complex')).toBe(
      '[0:v]scale=720:-2[v0]',
    );
  });
});

describe('ProgressParser', () => {
  it('returns the position at the end of each block, across chunk boundaries', () => {
    const parser = new ProgressParser();
    expect(parser.feed('frame=10\nout_time_us=1500000\nprog')).toEqual([]);
    expect(parser.feed('ress=continue\nout_time_us=3000000\nprogress=end\n')).toEqual([1.5, 3]);
  });

  it('ignores N/A before the first frame is encoded', () => {
    const parser = new ProgressParser();
    expect(parser.feed('out_time_us=N/A\nprogress=continue\n')).toEqual([]);
  });
});
