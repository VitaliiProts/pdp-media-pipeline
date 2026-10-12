import { fullJitterDelay } from './backoff';

const options = { baseMs: 1000, maxMs: 60_000 };

describe('fullJitterDelay', () => {
  it.each([
    [1, 1000],
    [2, 2000],
    [3, 4000],
    [6, 32_000],
    [7, 60_000],
    [50, 60_000],
  ])('after %i failure(s) waits below %i ms', (failures, ceiling) => {
    expect(fullJitterDelay(failures, options, () => 0.999999)).toBe(ceiling - 1);
    expect(fullJitterDelay(failures, options, () => 0)).toBe(0);
  });

  it('spreads delays over the whole range', () => {
    const delays = Array.from({ length: 1000 }, () => fullJitterDelay(3, options));
    expect(Math.min(...delays)).toBeLessThan(500);
    expect(Math.max(...delays)).toBeGreaterThan(3500);
  });
});
