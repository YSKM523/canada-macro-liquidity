import { describe, it, expect } from 'vitest';
import { runBacktest, type BtSnap } from '../src/backtest';

// Weekly snapshots, macro-bullish throughout (score 60 > 55 → macro always long).
// One sharp TSX drawdown at i=5 (spx[4]→spx[5] = -5.3%) triggers reconstructed stress,
// so the display decision goes flat at i=5 and avoids the i=5→i=6 loss that macro eats.
function buildSnaps(): BtSnap[] {
  const spx = [100, 101, 102, 103, 104, 98.5, 95, 96, 97, 98];
  return spx.map((px, i) => ({
    date: new Date(Date.UTC(2025, 0, 6) + i * 7 * 86_400_000).toISOString().slice(0, 10),
    score: 60,                       // macro BULLISH every week
    spx: px,
    usdcad: 1.36,                    // calm → no FX breach
    wti: 72,                         // calm → no oil breach
    factors: { netliqTrend: 60, reserveAdequacy: 60, impulse: 60, curve: 60, dollar: 60, oil: 60, funding: 60, rates: 60, credit: 60 },
  }));
}

describe('runBacktest decision=display vs macro (P1: backtest the seen decision)', () => {
  const snaps = buildSnaps();

  it('default = macro, and is byte-identical to explicit decision=macro', () => {
    expect(runBacktest(snaps)).toEqual(runBacktest(snaps, undefined, undefined, { decision: 'macro' }));
  });

  it('macro output has NO new fields (regression: existing /api/backtest shape)', () => {
    const r: any = runBacktest(snaps);
    expect(r.decision).toBeUndefined();
    expect(r.strategy_long_flat.flat_weeks_stress).toBeUndefined();
  });

  it('decision=display tags the result and reports stress-forced flat weeks', () => {
    const r: any = runBacktest(snaps, undefined, undefined, { decision: 'display' });
    expect(r.decision).toBe('display');
    expect(r.strategy_long_flat.flat_weeks_stress).toBeGreaterThan(0);
  });

  it('display goes flat through the stress week → better strategy return than macro', () => {
    const macro: any = runBacktest(snaps, undefined, undefined, { decision: 'macro' });
    const display: any = runBacktest(snaps, undefined, undefined, { decision: 'display' });
    expect(display.strategy_long_flat.ann_return).toBeGreaterThan(macro.strategy_long_flat.ann_return);
  });

  it('display prefers a STORED display_verdict over reconstruction when present', () => {
    // Force the calm week i=2 flat by stamping a stored downgraded verdict on it.
    const stamped = buildSnaps().map((s, i) => i === 2 ? { ...s, display_verdict: 'NEUTRAL' as const } : s);
    const r: any = runBacktest(stamped, undefined, undefined, { decision: 'display' });
    // i=2 is macro-bullish (score 60) but stored verdict NEUTRAL → counted as a stress-flat week
    expect(r.strategy_long_flat.flat_weeks_stress).toBeGreaterThanOrEqual(2);
  });

  it('IC horizons are identical across decisions (score is unchanged)', () => {
    const macro: any = runBacktest(snaps, undefined, undefined, { decision: 'macro' });
    const display: any = runBacktest(snaps, undefined, undefined, { decision: 'display' });
    expect(display.horizons).toEqual(macro.horizons);
  });
});
