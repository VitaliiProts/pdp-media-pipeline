import { decide, toGcraLimit } from './gcra';
import { LocalGcra } from './local-gcra';

const SECOND = 1_000_000;
const T0 = 1_700_000_000 * SECOND;
const user = toGcraLimit({ ratePerSec: 20, burst: 20 });

describe('toGcraLimit', () => {
  it('derives the interval and the burst tolerance in microseconds', () => {
    expect(user).toEqual({ intervalUs: 50_000, toleranceUs: 1_000_000 });
  });
});

describe('GCRA (LocalGcra over decide)', () => {
  it('admits a full burst at once, then refuses for one interval', () => {
    const gcra = new LocalGcra();
    const remaining = Array.from({ length: 20 }, () => gcra.check(['u'], [user], T0));
    expect(remaining.every((d) => d.allowed)).toBe(true);
    expect(remaining.map((d) => d.limits[0]?.remaining)).toEqual(
      Array.from({ length: 20 }, (_, i) => 19 - i),
    );

    const refused = gcra.check(['u'], [user], T0);
    expect(refused).toMatchObject({ allowed: false, retryAfterUs: 50_000 });
    expect(refused.limits[0]).toEqual({ remaining: 0, resetUs: SECOND });
  });

  it('admits the sustained rate after the burst is spent', () => {
    const gcra = new LocalGcra();
    for (let i = 0; i < 20; i++) gcra.check(['u'], [user], T0);

    expect(gcra.check(['u'], [user], T0 + 49_999).allowed).toBe(false);
    expect(gcra.check(['u'], [user], T0 + 50_000).allowed).toBe(true);
    expect(gcra.check(['u'], [user], T0 + 50_000).allowed).toBe(false);
  });

  it('refills the whole burst after a quiet period', () => {
    const gcra = new LocalGcra();
    for (let i = 0; i < 20; i++) gcra.check(['u'], [user], T0);
    const later = gcra.check(['u'], [user], T0 + SECOND);
    expect(later).toMatchObject({ allowed: true, limits: [{ remaining: 19 }] });
  });

  it('lets roughly rate × duration requests through a steady overload', () => {
    const gcra = new LocalGcra();
    let allowed = 0;
    // 40 rps for 10 s against 20 rps with burst 20.
    for (let i = 0; i < 400; i++) {
      if (gcra.check(['u'], [user], T0 + i * 25_000).allowed) allowed++;
    }
    expect(allowed).toBeGreaterThanOrEqual(215);
    expect(allowed).toBeLessThanOrEqual(221);
  });

  it('is all or nothing across limits', () => {
    const tight = toGcraLimit({ ratePerSec: 1, burst: 1 });
    const gcra = new LocalGcra();
    expect(gcra.check(['u', 'g'], [user, tight], T0).allowed).toBe(true);

    const refused = gcra.check(['u', 'g'], [user, tight], T0);
    expect(refused).toMatchObject({ allowed: false, retryAfterUs: SECOND });
    // The user's limit was not charged for the refused request.
    expect(gcra.check(['u'], [user], T0).limits[0]?.remaining).toBe(18);
  });

  it('reports the longest wait when several limits refuse', () => {
    const decision = decide(
      [toGcraLimit({ ratePerSec: 10, burst: 1 }), toGcraLimit({ ratePerSec: 2, burst: 1 })],
      [T0 + 100_000, T0 + 500_000],
      T0,
    );
    expect(decision).toMatchObject({ allowed: false, retryAfterUs: 500_000, newTats: [] });
  });
});
