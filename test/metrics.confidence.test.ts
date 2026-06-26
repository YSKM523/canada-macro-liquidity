import { describe, it, expect } from 'vitest';
import { computeConfidence } from '../src/metrics';
import { SERIES, WEIGHTS } from '../src/config';

const mk = (vals: [string, number][]) => vals.map(([date, value]) => ({ date, value }));

// Full series map: every factor's required series has data ≤ DATE.
function buildFullMap(): any {
  return {
    [SERIES.SETTLEMENT.id]:   mk([['2026-06-10', 67000], ['2026-06-17', 68000]]),
    [SERIES.TOTAL_ASSETS.id]: mk([['2026-06-10', 226000], ['2026-06-17', 225000]]),
    [SERIES.CORRA.id]:        mk([['2026-06-17', 2.96]]),
    [SERIES.TARGET.id]:       mk([['2026-06-17', 2.75]]),
    [SERIES.GOC10.id]:        mk([['2026-06-17', 3.42]]),
    [SERIES.GOC2.id]:         mk([['2026-06-17', 3.12]]),
    [SERIES.USDCAD.id]:       mk([['2026-06-17', 1.37]]),
    [SERIES.HY_OAS.id]:       mk([['2026-06-17', 3.45]]),
    [SERIES.WTI.id]:          mk([['2026-06-17', 73.00]]),
  };
}

const DATE = '2026-06-17';

describe('computeConfidence — weighted factor coverage (P1: missing data ≠ neutral)', () => {
  it('full coverage → confidence 1.0, nothing missing', () => {
    const r = computeConfidence(buildFullMap(), DATE);
    expect(r.confidence).toBeCloseTo(1.0, 10);
    expect(r.missing).toEqual([]);
  });

  it('missing oil (WTI absent) → confidence drops by oil weight', () => {
    const m = buildFullMap();
    delete m[SERIES.WTI.id];
    const r = computeConfidence(m, DATE);
    expect(r.confidence).toBeCloseTo(1 - WEIGHTS.oil, 10); // 0.94
    expect(r.missing).toEqual(['oil']);
  });

  it('missing credit (HY OAS absent) → confidence drops by credit weight', () => {
    const m = buildFullMap();
    delete m[SERIES.HY_OAS.id];
    const r = computeConfidence(m, DATE);
    expect(r.confidence).toBeCloseTo(1 - WEIGHTS.credit, 10); // 0.90
    expect(r.missing).toEqual(['credit']);
  });

  it('missing settlement → BOTH netliqTrend and reserveAdequacy uncovered (shared series)', () => {
    const m = buildFullMap();
    delete m[SERIES.SETTLEMENT.id];
    const r = computeConfidence(m, DATE);
    expect(r.confidence).toBeCloseTo(1 - WEIGHTS.netliqTrend - WEIGHTS.reserveAdequacy, 10); // 0.63
    expect(r.missing).toContain('netliqTrend');
    expect(r.missing).toContain('reserveAdequacy');
  });

  it('multiple independent missing factors sum their weights', () => {
    const m = buildFullMap();
    delete m[SERIES.WTI.id];     // oil
    delete m[SERIES.USDCAD.id];  // dollar
    const r = computeConfidence(m, DATE);
    expect(r.confidence).toBeCloseTo(1 - WEIGHTS.oil - WEIGHTS.dollar, 10); // 0.88
  });

  it('date-aware: a series whose only obs is AFTER date is not counted as covered', () => {
    const m = buildFullMap();
    m[SERIES.WTI.id] = mk([['2026-07-01', 73.00]]); // starts after DATE
    const r = computeConfidence(m, DATE);
    expect(r.confidence).toBeCloseTo(1 - WEIGHTS.oil, 10);
    expect(r.missing).toEqual(['oil']);
  });
});
