import { describe, it, expect } from 'vitest';
import { scoreDollar, scoreFunding, asOf } from '../src/metrics';

const mk = (vals: number[]) => vals.map((v, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, value: v }));

describe('directional scorers', () => {
  it('asOf returns latest value <= date', () => {
    expect(asOf(mk([1, 2, 3]), '2026-01-02')).toBe(2);
  });
  it('weak CAD (USDCAD rising above its mean) scores < 50 (headwind)', () => {
    const s = scoreDollar(mk([1.30, 1.31, 1.32, 1.45]), '2026-01-04');
    expect(s).toBeLessThan(50);
  });
  it('CORRA above target (funding stress) scores < 50', () => {
    const corra = mk([4.50, 4.51, 4.52, 4.62]);
    const target = mk([4.50, 4.50, 4.50, 4.50]);
    expect(scoreFunding(corra, target, '2026-01-04')).toBeLessThan(50);
  });
});
