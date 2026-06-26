import { describe, it, expect } from 'vitest';
import { runWalkForward, icWeights, weightedFrom } from '../src/walkforward';
import type { BtSnap } from '../src/backtest';

const FACTORS = ['netliqTrend','reserveAdequacy','impulse','curve','dollar','oil','funding','rates','credit'];

// Build N weekly snapshots where ONE factor (netliqTrend) genuinely predicts the
// 13-week-forward TSX return. netliqTrend is a slow sine (period 80w >> 13w horizon)
// so it is positively autocorrelated → the next-13-week cumulative return tracks the
// current reading. Two further factors (curve, dollar) carry VARIANCE but no
// predictive value (periods unrelated to the signal/horizon) — they dilute an
// equal-weight blend but get ~0 weight from IC-fitting. The rest are flat at 50.
function buildPredictiveSnaps(n = 320): BtSnap[] {
  const snaps: BtSnap[] = [];
  let spx = 100;
  const start = new Date('2017-01-02T00:00:00Z');
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime() + i * 7 * 86_400_000).toISOString().slice(0, 10);
    const signal = Math.sin((i * 2 * Math.PI) / 80);          // slow wave, [-1,1]
    const netliqTrend = 50 + 35 * signal;                      // predictive factor [15,85]
    const factors: Record<string, number> = {};
    for (const f of FACTORS) factors[f] = 50;                  // default flat
    factors.netliqTrend = netliqTrend;
    factors.curve  = 50 + 25 * Math.sin((i * 2 * Math.PI) / 17 + 0.7);  // variance, ~0 IC
    factors.dollar = 50 + 25 * Math.cos((i * 2 * Math.PI) / 23 + 2.1);  // variance, ~0 IC
    snaps.push({ date: d, score: netliqTrend, spx, factors });
    // next-week return driven by the signal + fast deterministic noise (averages out over 13w)
    const ret = 0.0008 * (netliqTrend - 50) + 0.006 * Math.sin((i * 2 * Math.PI) / 7);
    spx = spx * (1 + ret);
  }
  return snaps;
}

describe('runWalkForward — out-of-sample IC (P2: every weight change must check OOS)', () => {
  const snaps = buildPredictiveSnaps();
  const res = runWalkForward(snaps);

  it('produces ≥1 fold and well-formed config', () => {
    expect(res.config.folds).toBeGreaterThanOrEqual(1);
    expect(res.n_snapshots).toBe(snaps.length);
    expect(res.config.horizon_weeks).toBe(13);
  });

  it('recovers the planted signal: wf-fitted OOS IC clearly positive', () => {
    expect(res.oos.wf_fitted.n).toBeGreaterThan(0);
    expect(res.oos.wf_fitted.ic_spearman).toBeGreaterThan(0.1);
  });

  it('IC-fitted weights beat equal-weight OOS (concentrates on the predictive factor)', () => {
    expect(res.oos.wf_fitted.ic_spearman).toBeGreaterThanOrEqual(res.oos.equal_weight.ic_spearman);
    expect(res.folds[0].wf_top.some(t => t.startsWith('netliqTrend'))).toBe(true);
  });

  it('all OOS IC values are finite (NaN guarded)', () => {
    for (const arm of [res.oos.wf_fitted, res.oos.current_weights, res.oos.equal_weight]) {
      expect(Number.isFinite(arm.ic_spearman)).toBe(true);
      expect(Number.isFinite(arm.hit_rate)).toBe(true);
    }
  });

  it('short sample (< initialTrain+embargo) → no folds, no crash, finite zeros', () => {
    const tiny = runWalkForward(snaps.slice(0, 50));
    expect(tiny.config.folds).toBe(0);
    expect(tiny.oos.wf_fitted.n).toBe(0);
    expect(Number.isFinite(tiny.oos.wf_fitted.ic_spearman)).toBe(true);
  });
});

describe('icWeights — non-negative normalized factor IC', () => {
  it('weights sum to 1 and concentrate on the predictive factor', () => {
    const w = icWeights(buildPredictiveSnaps(220), 13);
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    // netliqTrend should carry meaningfully more weight than a noise factor
    expect(w.netliqTrend).toBeGreaterThan(w.oil);
  });

  it('weightedFrom blends factor scores by weights', () => {
    const w = Object.fromEntries(FACTORS.map(f => [f, f === 'netliqTrend' ? 1 : 0]));
    const fac = Object.fromEntries(FACTORS.map(f => [f, 50]));
    fac.netliqTrend = 80;
    expect(weightedFrom(fac, w)).toBeCloseTo(80, 6);
  });
});
