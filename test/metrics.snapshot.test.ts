import { describe, it, expect } from 'vitest';
import { computeSnapshot } from '../src/metrics';
import { SERIES, FACTOR_KEYS, WEIGHTS } from '../src/config';

const mk = (vals: [string, number][]) => vals.map(([date, value]) => ({ date, value }));

// Minimal series map with only the two mandatory series
const minimalMap: any = {
  [SERIES.SETTLEMENT.id]: mk([['2026-06-10', 67000], ['2026-06-17', 68367]]),   // V36636
  [SERIES.TOTAL_ASSETS.id]: mk([['2026-06-10', 226000], ['2026-06-17', 225775]]), // V36610
};

// Full series map with all 9 factor series populated
function buildFullMap(): any {
  // Build 30+ weekly obs so scoreNetliqTrend has enough data
  const settlementObs: [string, number][] = [];
  const totalAssetsObs: [string, number][] = [];
  for (let w = 0; w < 30; w++) {
    const d = new Date('2026-01-06');
    d.setDate(d.getDate() + w * 7);
    const ds = d.toISOString().slice(0, 10);
    settlementObs.push([ds, 60000 + w * 200]);
    totalAssetsObs.push([ds, 230000 - w * 100]);
  }

  return {
    [SERIES.SETTLEMENT.id]:   mk(settlementObs),
    [SERIES.TOTAL_ASSETS.id]: mk(totalAssetsObs),
    [SERIES.GOC_DEPOSITS.id]: mk([['2026-06-10', 15000]]),
    [SERIES.REVERSE_REPO.id]: mk([['2026-06-10', 2000]]),
    [SERIES.NOTES_CIRC.id]:   mk([['2026-06-10', 110000]]),
    [SERIES.CORRA.id]:        mk([['2026-06-10', 2.95], ['2026-06-17', 2.96]]),
    [SERIES.TARGET.id]:       mk([['2026-06-10', 2.75], ['2026-06-17', 2.75]]),
    [SERIES.GOC10.id]:        mk([['2026-06-10', 3.40], ['2026-06-17', 3.42]]),
    [SERIES.GOC2.id]:         mk([['2026-06-10', 3.10], ['2026-06-17', 3.12]]),
    [SERIES.USDCAD.id]:       mk([['2026-06-10', 1.36], ['2026-06-17', 1.37]]),
    [SERIES.HY_OAS.id]:       mk([['2026-06-10', 3.50], ['2026-06-17', 3.45]]),
    [SERIES.WTI.id]:          mk([['2026-06-10', 72.00], ['2026-06-17', 73.00]]),
  };
}

describe('computeSnapshot — brief-specified tests', () => {
  it('netliq equals settlement balances as-of date', () => {
    const s = computeSnapshot(minimalMap, '2026-06-17');
    expect(s.settlement_bal).toBe(68367);
    expect(s.netliq).toBe(68367);
  });

  it('coverage reflects fraction of factors with real data', () => {
    const s = computeSnapshot(minimalMap, '2026-06-17');
    expect(s.coverage).toBeCloseTo(3/9, 5);
  });
});

describe('computeSnapshot — full Snapshot interface', () => {
  const DATE = '2026-07-22'; // last weekly obs in full map
  let snap: ReturnType<typeof computeSnapshot>;

  it('returns all required fields', () => {
    snap = computeSnapshot(buildFullMap(), DATE);
    // All Snapshot fields must be present (not undefined)
    const required = [
      'date', 'total_assets', 'goc_deposits', 'reverse_repo', 'notes_circ',
      'settlement_bal', 'netliq', 'netliq_trend', 'corra_target', 'goc10', 'goc2',
      'usdcad', 'wti', 'hy_oas', 'qe_qt_regime', 'netliq_dir', 'verdict',
      'score', 'factors', 'coverage', 'p0', 'p1', 'p2', 'p3', 'reason',
    ] as const;
    for (const f of required) {
      expect(snap).toHaveProperty(f);
    }
  });

  it('date field matches input date', () => {
    snap = computeSnapshot(buildFullMap(), DATE);
    expect(snap.date).toBe(DATE);
  });

  it('score is in [0, 100]', () => {
    snap = computeSnapshot(buildFullMap(), DATE);
    expect(snap.score).toBeGreaterThanOrEqual(0);
    expect(snap.score).toBeLessThanOrEqual(100);
  });

  it('verdict is a valid Verdict string', () => {
    snap = computeSnapshot(buildFullMap(), DATE);
    expect(['BULLISH', 'NEUTRAL', 'BEARISH']).toContain(snap.verdict);
  });

  it('factors has all 9 keys with values in [0,100]', () => {
    snap = computeSnapshot(buildFullMap(), DATE);
    for (const k of FACTOR_KEYS) {
      expect(snap.factors).toHaveProperty(k);
      expect(snap.factors[k]).toBeGreaterThanOrEqual(0);
      expect(snap.factors[k]).toBeLessThanOrEqual(100);
    }
  });

  it('coverage: full map gives higher coverage than minimal map', () => {
    const fullSnap = computeSnapshot(buildFullMap(), DATE);
    const minSnap = computeSnapshot(minimalMap, '2026-06-17');
    expect(fullSnap.coverage).toBeGreaterThan(minSnap.coverage);
  });

  it('qe_qt_regime is one of EXPANDING/CONTRACTING/FLAT', () => {
    snap = computeSnapshot(buildFullMap(), DATE);
    expect(['EXPANDING', 'CONTRACTING', 'FLAT']).toContain(snap.qe_qt_regime);
  });

  it('netliq_dir is one of UP/DOWN/FLAT', () => {
    snap = computeSnapshot(buildFullMap(), DATE);
    expect(['UP', 'DOWN', 'FLAT']).toContain(snap.netliq_dir);
  });

  it('missing series still give valid score (factors default to 50, coverage decremented)', () => {
    // Only settlement + total_assets, all others missing
    const s = computeSnapshot(minimalMap, '2026-06-17');
    // score should still be a valid number (missing factors default to 50)
    expect(typeof s.score).toBe('number');
    expect(isNaN(s.score)).toBe(false);
    // coverage < 1 because most series are missing
    expect(s.coverage).toBeLessThan(1);
  });

  it('weights sum check: score equals weighted sum of factors', () => {
    snap = computeSnapshot(buildFullMap(), DATE);
    let expected = 0;
    for (const k of FACTOR_KEYS) {
      expected += snap.factors[k] * WEIGHTS[k];
    }
    expect(snap.score).toBeCloseTo(expected, 5);
  });

  it('p0..p3 are boolean pillar flags', () => {
    snap = computeSnapshot(buildFullMap(), DATE);
    expect(typeof snap.p0).toBe('boolean');
    expect(typeof snap.p1).toBe('boolean');
    expect(typeof snap.p2).toBe('boolean');
    expect(typeof snap.p3).toBe('boolean');
  });
});
