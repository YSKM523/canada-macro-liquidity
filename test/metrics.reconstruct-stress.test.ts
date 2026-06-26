import { describe, it, expect } from 'vitest';
import { reconstructStress } from '../src/metrics';

// A "snapshot" for stress reconstruction only needs the three CA price reads.
const snap = (tsx: number | null, usdcad: number | null, wti: number | null) =>
  ({ tsx, usdcad, wti });

describe('reconstructStress — historical stress from stored weekly prices (P1)', () => {
  it('calm week → not stressed, not unknown', () => {
    const prev = snap(20000, 1.36, 72);
    const cur  = snap(20100, 1.362, 72.5);   // tiny moves, no breach
    const r = reconstructStress(prev, cur);
    expect(r.stressed).toBe(false);
    expect(r.unknown).toBe(false);
  });

  it('TSX week-over-week crash (< -4%) → stressed', () => {
    const prev = snap(20000, 1.36, 72);
    const cur  = snap(19000, 1.36, 72);      // -5% TSX
    expect(reconstructStress(prev, cur).stressed).toBe(true);
  });

  it('CAD weakening (USDCAD > +2%) → stressed', () => {
    const prev = snap(20000, 1.36, 72);
    const cur  = snap(20000, 1.40, 72);      // +2.9% USDCAD
    expect(reconstructStress(prev, cur).stressed).toBe(true);
  });

  it('WTI crash (< -8%) → stressed', () => {
    const prev = snap(20000, 1.36, 72);
    const cur  = snap(20000, 1.36, 65);      // -9.7% WTI
    expect(reconstructStress(prev, cur).stressed).toBe(true);
  });

  it('VIX always absent in CA → missing=1 alone is NOT unknown', () => {
    const prev = snap(20000, 1.36, 72);
    const cur  = snap(20100, 1.36, 72);
    expect(reconstructStress(prev, cur).unknown).toBe(false); // only VIX missing
  });

  it('a second missing series (e.g. WTI) on top of absent VIX → unknown', () => {
    const prev = snap(20000, 1.36, 72);
    const cur  = snap(20100, 1.36, null);    // WTI missing + VIX absent = 2 missing
    expect(reconstructStress(prev, cur).unknown).toBe(true);
  });

  it('missing prior reading → that series cannot be evaluated (counts as missing)', () => {
    const prev = snap(null, 1.36, 72);
    const cur  = snap(20100, 1.36, 72);      // TSX has no prev → TSX missing + VIX = unknown
    expect(reconstructStress(prev, cur).unknown).toBe(true);
  });
});
