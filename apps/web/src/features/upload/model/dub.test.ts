import { type DubQuota, dubBlockOf, uploadDubBlocksOf } from './dub';

const quota = (remainingSeconds: number): DubQuota => ({
  usedSeconds: 1800 - remainingSeconds,
  limitSeconds: 1800,
  remainingSeconds,
  systemLimited: false,
  maxVideoSeconds: 60,
  resetsAt: '2026-11-01T00:00:00.000Z',
});

describe('dubBlockOf', () => {
  it('refuses a video longer than a dub may be', () => {
    expect(dubBlockOf(61, quota(1800), { measured: true })).toBe('tooLong');
    expect(dubBlockOf(61, quota(1800), { measured: false })).toBe('tooLong');
    expect(dubBlockOf(60, quota(1800), { measured: true })).toBeNull();
  });

  it('counts a measured file by its duration, rounded up as the gateway does', () => {
    expect(dubBlockOf(20.2, quota(21), { measured: true })).toBeNull();
    expect(dubBlockOf(20.2, quota(20), { measured: true })).toBe('overQuota');
  });

  it('holds a full dub for a file the library has not measured', () => {
    expect(dubBlockOf(10, quota(59), { measured: false })).toBe('overQuota');
    expect(dubBlockOf(null, quota(59), { measured: true })).toBe('overQuota');
    expect(dubBlockOf(null, quota(60), { measured: true })).toBeNull();
  });

  it('blames the service-wide limit when that is what leaves too little', () => {
    const shared = { ...quota(15), systemLimited: true };
    expect(dubBlockOf(20, shared, { measured: true })).toBe('overSystemQuota');
    expect(dubBlockOf(15, shared, { measured: true })).toBeNull();
  });
});

describe('uploadDubBlocksOf', () => {
  it('lets each new upload hold a full dub of what is left', () => {
    expect(uploadDubBlocksOf([10, 90, 20, 30], quota(130))).toEqual([
      null,
      'tooLong',
      null,
      'overQuota',
    ]);
  });
});
