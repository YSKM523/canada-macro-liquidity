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
export const WEIGHTS = {
  netliqTrend: 0.30, reserveAdequacy: 0.10, impulse: 0.08, curve: 0.12,
  dollar: 0.12, oil: 0.08, funding: 0.08, rates: 0.06, credit: 0.06,
} as const;

export const COVERAGE_FACTORS = FACTOR_KEYS;

// Bank of Canada concluded QT and restarted term repo operations effective 2025-03-05,
// ending balance-sheet runoff (announced 2025-01-29). Source: bankofcanada.ca/2025/01 QT-end releases.
export const CA_QT_END_DATE = '2025-03-05';
export const VERDICT_BANDS = { bull: 55, bear: 45 } as const;
export const STRESS = { vix: 25, tsxDd: -0.04, usdcad: 0.02, wti: -0.08 } as const; // 5-day thresholds
export const STRESS_SCORE_CEILING = 55;
export const INGEST_STALE_HOURS = 12;
export const NETLIQ_TREND_WEEKS = 13;
