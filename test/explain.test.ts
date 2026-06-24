import { describe, it, expect } from 'vitest';
import { factorContributions, attributeScoreChange, decomposeNetliq } from '../src/explain';
import { WEIGHTS, COVERAGE_FACTORS } from '../src/config';

// Helper: weighted score (mirrors metrics.ts scorer, no clamp so identity holds exactly)
function weightedScore(f: Record<string, number>): number {
  return COVERAGE_FACTORS.reduce((s, k) => s + (f[k] ?? 50) * ((WEIGHTS as Record<string,number>)[k] ?? 0), 0);
}

// CA factors: 9 keys, all weights > 0 (no zero-weight keys like US 'vol')
// Mid-range values so weightedScore is not clamped → exact identity holds
const F: Record<string, number> = {
  netliqTrend: 62, reserveAdequacy: 47, impulse: 48, curve: 66,
  dollar: 58, oil: 55, funding: 50, rates: 44, credit: 55,
};
const G: Record<string, number> = {
  netliqTrend: 55, reserveAdequacy: 51, impulse: 50, curve: 60,
  dollar: 63, oil: 52, funding: 50, rates: 46, credit: 52,
};

describe('factorContributions', () => {
  it('sums to weightedScore − 50 (cross-checks explain against the real scorer)', () => {
    const sum = factorContributions(F).reduce((a, c) => a + c.contribution, 0);
    expect(sum).toBeCloseTo(weightedScore(F) - 50, 6);
  });

  it('returns all 9 CA scoring factors', () => {
    const r = factorContributions(F);
    expect(r.length).toBe(COVERAGE_FACTORS.length);
    // All 9 CA factor keys present
    for (const k of COVERAGE_FACTORS) {
      expect(r.some(c => c.key === k)).toBe(true);
    }
  });

  it('sorted by |contribution| descending', () => {
    const xs = factorContributions(F).map(c => Math.abs(c.contribution));
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1]).toBeGreaterThanOrEqual(xs[i]);
  });

  it('defaults missing factors to 50 (zero contribution)', () => {
    const r = factorContributions({});
    for (const c of r) expect(c.contribution).toBeCloseTo(0, 9);
  });
});

describe('attributeScoreChange', () => {
  it('sums to weightedScore(cur) − weightedScore(ref)', () => {
    const sum = attributeScoreChange(F, G).reduce((a, c) => a + c.deltaContribution, 0);
    expect(sum).toBeCloseTo(weightedScore(F) - weightedScore(G), 6);
  });

  it('returns 9 entries and sorts by |deltaContribution| desc', () => {
    const arr = attributeScoreChange(F, G);
    expect(arr.length).toBe(COVERAGE_FACTORS.length);
    const xs = arr.map(c => Math.abs(c.deltaContribution));
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1]).toBeGreaterThanOrEqual(xs[i]);
  });

  it('identical cur and ref → all deltaContributions are 0', () => {
    const arr = attributeScoreChange(F, F);
    for (const a of arr) expect(a.deltaContribution).toBeCloseTo(0, 9);
  });
});

describe('decomposeNetliq (CA bridge: total_assets − notes_circ − goc_deposits − reverse_repo)', () => {
  // Concrete realistic BoC balance-sheet values (millions CAD)
  // settlement_bal = real V36636 (may differ from bridge_approx due to other liabilities/equity)
  const REAL_SETTL_BAL = 48_900;   // V36636 actual reported value (not equal to bridge_approx)
  const REF_SETTL_BAL  = 47_200;
  const curBS = { settlement_bal: REAL_SETTL_BAL, total_assets: 225_775, notes_circ: 120_500, goc_deposits: 40_200, reverse_repo: 15_300 };
  const refBS = { settlement_bal: REF_SETTL_BAL,  total_assets: 220_000, notes_circ: 119_800, goc_deposits: 38_000, reverse_repo: 14_000 };

  it('current.settlement_bal carries the REAL V36636 passed in (not the derived bridge sum)', () => {
    const d = decomposeNetliq(curBS, refBS);
    expect(d.current.settlement_bal).toBe(REAL_SETTL_BAL);
    // bridge_approx = 225775 − 120500 − 40200 − 15300 = 49775 — differs from real settlement_bal
    expect(d.current.bridge_approx).toBeCloseTo(49_775, 6);
    expect(d.current.settlement_bal).not.toEqual(d.current.bridge_approx);
  });

  it('reference.settlement_bal carries the REAL V36636 passed in', () => {
    const d = decomposeNetliq(curBS, refBS);
    expect(d.reference!.settlement_bal).toBe(REF_SETTL_BAL);
  });

  it('bridge_approx = total_assets − notes_circ − goc_deposits − reverse_repo', () => {
    const d = decomposeNetliq(curBS, refBS);
    const expected = curBS.total_assets - curBS.notes_circ - curBS.goc_deposits - curBS.reverse_repo;
    expect(d.current.bridge_approx).toBeCloseTo(expected, 6);
    // Concrete: 225775 − 120500 − 40200 − 15300 = 49775
    expect(d.current.bridge_approx).toBeCloseTo(49_775, 6);
  });

  it('delta bridge_approx identity: Δbridge ≈ Δtotal_assets − Δnotes_circ − Δgoc_deposits − Δreverse_repo', () => {
    const d = decomposeNetliq(curBS, refBS);
    const dTotal = curBS.total_assets - refBS.total_assets;   //  5775
    const dNotes = curBS.notes_circ   - refBS.notes_circ;    //   700
    const dGoc   = curBS.goc_deposits - refBS.goc_deposits;  //  2200
    const dRrp   = curBS.reverse_repo - refBS.reverse_repo;  //  1300
    expect(d.delta!.bridge_approx).toBeCloseTo(dTotal - dNotes - dGoc - dRrp, 6);
    // 5775 − 700 − 2200 − 1300 = 1575
    expect(d.delta!.bridge_approx).toBeCloseTo(1_575, 6);
  });

  it('delta.settlement_bal = current.settlement_bal − reference.settlement_bal', () => {
    const d = decomposeNetliq(curBS, refBS);
    expect(d.delta!.settlement_bal).toBeCloseTo(REAL_SETTL_BAL - REF_SETTL_BAL, 6);
  });

  it('reference null → reference and delta are null', () => {
    const d = decomposeNetliq(curBS, null);
    expect(d.reference).toBeNull();
    expect(d.delta).toBeNull();
  });

  it('null component → bridge_approx is null (no fabricated 0-coercion)', () => {
    const curWithNull = { settlement_bal: REAL_SETTL_BAL, total_assets: 225_775, notes_circ: null, goc_deposits: 40_200, reverse_repo: 15_300 };
    const d = decomposeNetliq(curWithNull, null);
    // Real settlement_bal still propagates
    expect(d.current.settlement_bal).toBe(REAL_SETTL_BAL);
    // bridge_approx must be null, NOT 0 or a fabricated sum
    expect(d.current.bridge_approx).toBeNull();
  });

  it('null settlement_bal in ref → delta.settlement_bal is null', () => {
    const refNullSettl = { settlement_bal: null, total_assets: 220_000, notes_circ: 119_800, goc_deposits: 38_000, reverse_repo: 14_000 };
    const d = decomposeNetliq(curBS, refNullSettl);
    expect(d.delta!.settlement_bal).toBeNull();
  });
});
