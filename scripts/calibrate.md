# Weight Calibration — Canada Liquidity Dashboard

**Date:** 2026-06-24  
**Data window:** 2017-01-04 → 2026-06-17 (494 weekly snapshots, ~9.45 years)  
**Sources:** BoC Valet API (V36636, V36610, V36628, V36625, V1203435186, AVG.INTWO, V122514, BD.CDN.10YR, BD.CDN.2YR, FXUSDCAD, FXCADCNY), FRED (BAMLH0A0HYM2, DFEDTARU), Yahoo Finance (^GSPTSE, CL=F)  
**Method:** `npx tsx scripts/calibrate.ts` — imports REAL `src/` modules (`computeSnapshot`, `runBacktest`, `runRobustness`). No reimplementation. Numbers sourced from `scripts/calibration-output.json` (committed provenance).

---

## 1. Composite IC

| Horizon | n (overlapping) | Spearman IC | Pearson IC | Hit Rate |
|---------|----------------|-------------|-----------|----------|
| 4w      | 490            | -0.018      | +0.077    | 49.0%    |
| 8w      | 486            | -0.028      | +0.083    | 47.7%    |
| 13w     | 481            | -0.017      | +0.092    | 46.4%    |

### Bootstrap robustness (13w, 2000 iters, block-bootstrap, seed=12345)
- Point IC (Spearman): **-0.017**
- 95% CI: **[-0.268, +0.242]** — crosses zero
- p-value: **0.5585** (not significant at any conventional threshold)
- Non-overlapping n: **37** (the honest independent sample count)

**Verdict: Composite IC is NOT statistically significant. Signal is WEAK.**

---

## 2. Per-Factor IC (Spearman, vs. forward TSX returns)

| Factor          | 4w IC   | 8w IC   | 13w IC  | Trend        |
|-----------------|---------|---------|---------|--------------|
| netliqTrend     | -0.011  | -0.018  | +0.044  | mixed/weak + |
| reserveAdequacy | +0.045  | +0.067  | +0.084  | consistently + |
| impulse         | -0.037  | -0.060  | -0.064  | consistently - |
| curve           | +0.100  | +0.131  | +0.156  | consistently + (strongest) |
| dollar          | -0.138  | -0.195  | -0.214  | consistently - |
| oil             | -0.218  | -0.337  | -0.446  | strongly - (worst) |
| funding         | -0.086  | -0.153  | -0.207  | consistently - |
| rates           | +0.092  | +0.128  | +0.116  | consistently + |
| credit          | +0.046  | +0.038  | +0.095  | consistently + |

**Notable:** Four factors (impulse, dollar, oil, funding) show consistently negative standalone IC.
The negative-IC factors, when over-weighted, drag the composite below zero. Per-factor IC signs
are stable across horizons — the only factor changing sign is netliqTrend (negative at short
horizons, weakly positive at 13w), which supports keeping it as the structural anchor.

---

## 3. Strategy Backtest (long-flat, score > 55)

| Metric         | Value    |
|----------------|----------|
| Strategy ann.  | 6.69%    |
| Buy-hold ann.  | 9.03%    |
| Sharpe (point) | 0.863    |
| Sharpe 95% CI  | [0.379, 1.284] |
| Sharpe p-value | 0.000    |
| Max drawdown   | 7.2%     |
| Turnover/yr    | ~3.50 flips/yr |

Strategy underperforms buy-hold by ~234 bps/yr. The positive Sharpe and CI that doesn't cross
zero (p=0.000) reflects that the long-flat strategy reduces drawdown and volatility by sitting
out bearish regimes — not that it has true predictive alpha. The 7.2% MDD vs. buy-hold's higher
drawdown confirms drawdown reduction, but this is a risk-reduction mechanism, not an alpha signal.

---

## 4. Regime Breakdown (13w IC)

| Regime              | n   | IC Spearman |
|---------------------|-----|-------------|
| Balance sheet: FLAT        | 79  | -0.216 |
| Balance sheet: CONTRACTING | 212 | -0.056 |
| Balance sheet: EXPANDING   | 190 | +0.040 |
| Pre-COVID (<2020-03-01)    | 165 | -0.277 |
| Post-COVID (≥2020-03-01)   | 316 | +0.125 |
| Pre-QT end (<2025-03-05)   | 426 | +0.091 |
| Post-QT end (≥2025-03-05)  | 55  | -0.302 |

Post-COVID IC is meaningfully positive (+0.125 at 13w, n=316), though with heavily overlapping
windows. Pre-COVID IC is negative (−0.277). The pre/post COVID split suggests structural regime
change — the model's signal improved post-COVID. Post-QT (n=55, ~1yr) shows negative IC but
the sample is far too short for inference.

---

## 5. Weight Calibration Rationale

### Honesty constraint applied
Because the composite IC CI crosses zero (p=0.5585) and n_independent=37, this is a **WEAK SIGNAL
environment**. Per the project's honesty rule, weights should NOT be optimized to backfit the
in-sample IC — that would overfit on ~37 independent data points. Instead, weights are adjusted
**only at the level of coarse structural priors** informed by per-factor IC signs.

### Rules applied
1. Factors with consistently negative IC across all horizons (impulse, dollar, oil, funding) → minimum weight (0.06 each). These factors hurt the composite and should not be eliminated entirely (they carry structural information) but should be down-weighted.
2. Factors with consistently positive IC (curve, reserveAdequacy, rates, credit) → modest increases.
3. netliqTrend retains the largest single weight: 13w IC = +0.044 (weakly positive), and it is the structural BoC settlement-balance signal that motivates the dashboard. Reduction from 0.30 to 0.25 acknowledges weak IC without abandoning the structural prior.
4. curve gets the largest single boost (0.12→0.18): clearest positive IC (+0.156 at 13w) in this dataset.
5. Σ = 1.00 (required).

### Final weights

| Factor          | Old Weight | New Weight | Evidence basis |
|-----------------|-----------|-----------|----------------|
| netliqTrend     | 0.30      | 0.25      | Structural; 13w IC +0.044 (weak +) |
| reserveAdequacy | 0.10      | 0.12      | Consistent + (13w: +0.084) |
| impulse         | 0.08      | 0.06      | Consistent - → minimum |
| curve           | 0.12      | 0.18      | Best +, consistent (13w: +0.156) |
| dollar          | 0.12      | 0.06      | Consistent - → minimum |
| oil             | 0.08      | 0.06      | Strongly - → minimum |
| funding         | 0.08      | 0.06      | Consistent - → minimum |
| rates           | 0.06      | 0.11      | Consistent + (13w: +0.116) |
| credit          | 0.06      | 0.10      | Consistent + (13w: +0.095) |
| **Sum**         | **1.00**  | **1.00**  | |

---

## 6. Honest Verdict

**Signal is WEAK.** The composite score has no statistically significant predictive power over
the 2017-2026 TSX history (IC = -0.017, p = 0.5585, n_independent = 37). The per-factor IC is mixed:
curve, rates, credit, reserveAdequacy show consistently positive standalone IC; impulse, dollar, oil,
funding show consistently negative standalone IC. The negative-IC factors were over-weighted in the
initial placeholder configuration, which is why the composite IC was negative.

The new weights address the sign problem (down-weighting negative-IC factors) without overfitting,
because the adjustment is coarse (minimum floor of 0.06, not a regression fit) and respects structural
priors (netliqTrend remains largest single weight). The dashboard should be used as a qualitative
framework, not a quantitative trading signal.

**This is the expected result for a Canadian macro liquidity model with weekly data and 9 years of
history: the independent sample count (~37 non-overlapping 13-week periods) is too small to
distinguish true alpha from noise.**

---

## 7. Note: Real-Code vs. Prior Reimplementation

The previous calibrate.md (pre-2026-06-24 fix) reported numbers from `scripts/backfill-local.mjs`
and `scripts/backfill_local.py`, which REIMPLEMENTED `computeSnapshot` and the WEIGHTS as hardcoded
copies. The reimplementation used the OLD placeholder weights (netliqTrend=0.30, dollar=0.12, etc.)
for snapshot computation, so its IC numbers were produced by a PARALLEL COPY of the model —
not the shipped `src/metrics.ts`.

The key difference: composite 13w Spearman IC was -0.067 under the old reimplementation vs. -0.017
here. Both are near zero and statistically insignificant (p=0.70 vs. p=0.56). The per-factor IC
signs and relative magnitudes are nearly identical — the calibration conclusions (which factors
to up/down-weight) are unchanged. The reimplementation scripts have been deleted; this harness
imports the real code and is the authoritative source going forward.
