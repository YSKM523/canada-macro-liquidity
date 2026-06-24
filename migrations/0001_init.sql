CREATE TABLE IF NOT EXISTS observation (
  series_id TEXT NOT NULL, date TEXT NOT NULL, value REAL,
  PRIMARY KEY (series_id, date)
);
CREATE TABLE IF NOT EXISTS daily_snapshot (
  date TEXT PRIMARY KEY,
  total_assets REAL, goc_deposits REAL, reverse_repo REAL, notes_circ REAL,
  settlement_bal REAL,            -- net liquidity (millions CAD)
  netliq REAL, netliq_trend REAL, -- settlement_bal alias + 13wk trend
  corra_target REAL,              -- CORRA - overnight target
  goc10 REAL, goc2 REAL, usdcad REAL, wti REAL, hy_oas REAL, vix_eod REAL,
  qe_qt_regime TEXT, netliq_dir TEXT, verdict TEXT, score REAL,
  p0 INTEGER, p1 INTEGER, p2 INTEGER, p3 INTEGER,
  tsx REAL, reason TEXT, factors_json TEXT, coverage REAL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
