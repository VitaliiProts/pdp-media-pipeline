import { act, renderHook } from '@testing-library/react';
import { useCountdown } from './use-countdown';

describe('useCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts whole seconds down to zero and stops', () => {
    const { result } = renderHook(() => useCountdown());
    expect(result.current[0]).toBe(0);

    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current[0]).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current[0]).toBe(0);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current[0]).toBe(0);
  });

  it('starts over when started again', () => {
    const { result } = renderHook(() => useCountdown());
    act(() => result.current[1](5));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => result.current[1](10));
    expect(result.current[0]).toBe(10);
  });
});
