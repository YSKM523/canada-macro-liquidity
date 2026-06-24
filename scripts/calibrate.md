# Weight Calibration — Canada Liquidity Dashboard

**Date:** 2026-06-24  
**Data window:** 2017-01-04 → 2026-06-17 (494 weekly snapshots, ~9.45 years)  
**Sources:** BoC Valet API (V36636, V36610, V36628, V36625, V1203435186, AVG.INTWO, V122514, BD.CDN.10YR, BD.CDN.2YR, FXUSDCAD, FXCADCNY), FRED (BAMLH0A0HYM2, DFEDTARU), Yahoo Finance (^GSPTSE, CL=F)  
**Backfill method:** All series fetched from external APIs into local Miniflare D1 SQLite. Snapshots computed weekly on BoC total-assets (V36610) dates.

---

## 1. Composite IC

| Horizon | n (overlapping) | Spearman IC | Pearson IC | Hit Rate |
|---------|----------------|-------------|-----------|----------|
| 4w      | 490            | -0.055      | +0.034    | 45.7%    |
| 8w      | 486            | -0.078      | +0.020    | 44.9%    |
| 13w     | 481            | -0.067      | +0.012    | 44.7%    |

### Bootstrap robustness (13w, 2000 iters, block-bootstrap)
- Point IC (Spearman): **-0.067**
- 95% CI: **[-0.324, +0.206]** — crosses zero
- p-value: **0.70** (not significant at any conventional threshold)
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
| credit          | +0.057  | +0.056  | +0.114  | consistently + |

**Notable:** Four factors (impulse, dollar, oil, funding) show consistently negative standalone IC.
This is why the composite IC is negative despite several positive-IC factors: the high-weight negative-IC
factors (dollar 0.12, oil 0.08, funding 0.08, impulse 0.08 = 0.36 combined) were dragging the composite down.

The negative IC for dollar and oil likely reflects that the scoring direction is correct (high USDCAD = bearish CAD → lower score; high oil = bullish commodity → higher score) but the correlation between these factors and near-term TSX returns is reversed in this history. The oil factor in particular is strongly negatively correlated with forward TSX returns at 13w (-0.446), suggesting that high oil prices in this era often preceded TSX weakness (commodity price reversals or global slowdown signals).

---

## 3. Strategy Backtest (long-flat, score > 55)

| Metric         | Value    |
|----------------|----------|
| Strategy ann.  | 6.01%    |
| Buy-hold ann.  | 9.03%    |
| Sharpe (point) | 0.749    |
| Sharpe 95% CI  | [0.119, 1.234] |
| Sharpe p-value | 0.007    |
| Max drawdown   | 10.3%    |
| Turnover/yr    | 4.77 flips/yr |

Strategy underperforms buy-hold by ~300 bps/yr. Sharpe CI does not cross zero (p=0.007), but
this is because the strategy reduces drawdown and volatility by being out-of-market ~half the time,
not because it has alpha. The positive Sharpe reflects low-vol cash periods, not predictive power.

---

## 4. Regime Breakdown (13w IC)

| Regime              | n   | IC Spearman |
|---------------------|-----|-------------|
| Balance sheet: FLAT        | 79  | -0.279 |
| Balance sheet: CONTRACTING | 212 | -0.131 |
| Balance sheet: EXPANDING   | 190 | +0.032 |
| Pre-COVID (<2020-03-01)    | 165 | -0.181 |
| Post-COVID (≥2020-03-01)   | 316 | +0.002 |
| Pre-QT end (<2025-03-05)   | 426 | +0.075 |
| Post-QT end (≥2025-03-05)  | 55  | -0.235 |

Regime breakdown shows IC is near zero post-COVID (most of the history) and positive only in
the pre-QT-end window (n=426, IC=+0.075). The post-QT regime (n=55, only ~1 year) shows negative IC
but is too short to draw conclusions. IC is consistently negative in non-EXPANDING balance-sheet regimes.

---

## 5. Weight Calibration Rationale

### Honesty constraint applied
Because the composite IC CI crosses zero (p=0.70) and n_independent=37, this is a **WEAK SIGNAL
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
| netliqTrend     | 0.30      | 0.25      | Structural; 13w IC +0.04 (weak +) |
| reserveAdequacy | 0.10      | 0.12      | Consistent + (13w: +0.084) |
| impulse         | 0.08      | 0.06      | Consistent - → minimum |
| curve           | 0.12      | 0.18      | Best +, consistent (13w: +0.156) |
| dollar          | 0.12      | 0.06      | Consistent - → minimum |
| oil             | 0.08      | 0.06      | Strongly - → minimum |
| funding         | 0.08      | 0.06      | Consistent - → minimum |
| rates           | 0.06      | 0.11      | Consistent + (13w: +0.116) |
| credit          | 0.06      | 0.10      | Consistent + (13w: +0.114) |
| **Sum**         | **1.00**  | **1.00**  | |

---

## 6. Honest Verdict

**Signal is WEAK.** The composite score has no statistically significant predictive power over
the 2017-2026 TSX history (IC = -0.067, p = 0.70, n_independent = 37). The per-factor IC is mixed:
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
