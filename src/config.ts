export const SERIES = {
  TOTAL_ASSETS: { id: 'V36610', source: 'boc', unit: 'M' },
  GOC_DEPOSITS: { id: 'V36628', source: 'boc', unit: 'M' },
  SETTLEMENT:   { id: 'V36636', source: 'boc', unit: 'M' },
  REVERSE_REPO: { id: 'V1203435186', source: 'boc', unit: 'M' },
  NOTES_CIRC:   { id: 'V36625', source: 'boc', unit: 'M' },
  CORRA:        { id: 'AVG.INTWO', source: 'boc', unit: 'pct' },
  TARGET:       { id: 'V122514', source: 'boc', unit: 'pct' },
  GOC10:        { id: 'BD.CDN.10YR.DQ.YLD', source: 'boc', unit: 'pct' },
  GOC2:         { id: 'BD.CDN.2YR.DQ.YLD', source: 'boc', unit: 'pct' },
  USDCAD:       { id: 'FXUSDCAD', source: 'boc', unit: 'fx' },
  CADCNY:       { id: 'FXCADCNY', source: 'boc', unit: 'fx' },
  US_RATE:      { id: 'DFEDTARU', source: 'fred', unit: 'pct' },
  HY_OAS:       { id: 'BAMLH0A0HYM2', source: 'fred', unit: 'pct' },
  WTI:          { id: 'WTI', source: 'yahoo', unit: 'usd' },
  TSX:          { id: '^GSPTSE', source: 'yahoo', unit: 'idx' },
} as const;

export const SERIES_IDS_BOC = Object.values(SERIES).filter(s => s.source === 'boc').map(s => s.id);
export const SERIES_IDS_FRED = Object.values(SERIES).filter(s => s.source === 'fred').map(s => s.id);
export const YAHOO_SYMBOLS = { TSX: '^GSPTSE', WTI: 'CL=F' } as const;

export const FACTOR_KEYS = ['netliqTrend','reserveAdequacy','impulse','curve','dollar','oil','funding','rates','credit'] as const;
// Weights calibrated 2026-06-24 from REAL src/ code (scripts/calibrate.ts → scripts/calibration-output.json).
// No reimplementation — computeSnapshot/runBacktest/runRobustness imported directly from src/.
// Window: 2017-01-04→2026-06-17, n=494 snapshots, ~9.45 years.
// Composite IC (13w Spearman) = +0.005 (bootstrap 95% CI: [-0.237, +0.247], p=0.483, n_independent=37)
//   — recomputed 2026-06-25 after the impulse Δ4w fix; still ~0 / not significant (signal is WEAK).
// Weights are structural priors informed by per-factor IC signs, not fitted alpha.
// Factors with clearly negative IC across all horizons (dollar, oil, funding) are held at minimum
// weight (0.06); positive-IC factors (curve, reserveAdequacy, rates, credit) receive proportionally
// more weight. netliqTrend (structural settlement-balance signal, 13w IC = +0.044) retains the
// largest single weight. Σ = 1.00.
// NOTE: impulse was fixed from a total-assets *level* z-score to a Δ4w *change* z-score (2026-06-25),
// flipping its IC positive (13w +0.051). Its weight is deliberately LEFT at the 0.06 floor for this
// consistency-only change (not re-fit); a future re-weight may promote it into the positive-IC group.
export const WEIGHTS = {
  netliqTrend: 0.25, reserveAdequacy: 0.12, impulse: 0.06, curve: 0.18,
  dollar: 0.06, oil: 0.06, funding: 0.06, rates: 0.11, credit: 0.10,
} as const;

export const COVERAGE_FACTORS = FACTOR_KEYS;

// Bank of Canada concluded QT and restarted term repo operations effective 2025-03-05,
// ending balance-sheet runoff (announced 2025-01-29). Source: bankofcanada.ca/2025/01 QT-end releases.
export const CA_QT_END_DATE = '2025-03-05';
export const VERDICT_BANDS = { bull: 55, bear: 45 } as const;
export const STRESS = { vix: 25, tsxDd: -0.04, usdcad: 0.02, wti: -0.08 } as const; // 5-day thresholds
export const INGEST_STALE_HOURS = 12;
export const NETLIQ_TREND_WEEKS = 13;  // netliqTrend = settlement-balance Δ13w change z
export const IMPULSE_DELTA_WEEKS = 4;  // impulse = total-assets Δ4w expansion/contraction z (matches qe_qt_regime 4w delta)
