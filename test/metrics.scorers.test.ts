import { describe, it, expect } from 'vitest';
import { scoreDollar, scoreFunding, asOf, scoreNetliqTrend } from '../src/metrics';

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

describe('scoreNetliqTrend (regression test for string-date bug)', () => {
  it('should score > 50 when most recent 13wk change is largest (bullish trend) with ≥12 changes', () => {
    // Build series: mostly small changes, then final 13wk change is large and positive
    // Values: [100, 100.1, 100.2, ..., 101.2 (at idx 12), ..., 101.3 (at idx 25), 115 (at idx 26, so 26-13=113-100=13)]
    const values: number[] = [];
    for (let i = 0; i < 13; i++) values.push(100 + i * 0.1); // [100, 100.1, ..., 101.2]
    for (let i = 13; i < 26; i++) values.push(101.2 + (i - 13) * 0.01); // tiny increments
    values.push(114); // idx 26: huge jump → 13wk change = 114 - 101 = 13 (largest)
    const series = mk(values);
    const lastDate = `2026-01-${String(values.length).padStart(2, '0')}`;
    const score = scoreNetliqTrend(series, lastDate, 13);
    expect(score).toBeGreaterThan(50);
  });

  it('should score < 50 when most recent 13wk change is smallest (bearish trend) with ≥12 changes', () => {
    // Build series: mostly positive changes, then final 13wk change is large and negative
    const values: number[] = [];
    for (let i = 0; i < 13; i++) values.push(100 + i * 0.5); // [100, 100.5, 101, ..., 106]
    for (let i = 13; i < 26; i++) values.push(106 + (i - 13) * 0.5); // continuing growth
    values.push(100); // idx 26: big drop → 13wk change = 100 - 112.5 = -12.5 (smallest)
    const series = mk(values);
    const lastDate = `2026-01-${String(values.length).padStart(2, '0')}`;
    const score = scoreNetliqTrend(series, lastDate, 13);
    expect(score).toBeLessThan(50);
  });
});
