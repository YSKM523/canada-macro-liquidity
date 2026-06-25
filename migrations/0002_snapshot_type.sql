-- P1: canonical weekly backtest.
-- Tag each snapshot weekly (canonical BoC-date) vs daily (carry-forward intraday).
-- The cron rebuilds the trailing 14 calendar days (eachDay), so non-BoC dates get
-- carry-forward snapshots that, mixed into the backtest, pollute IC with
-- autocorrelation + uneven spacing. Backtest/robustness now use weekly only.

ALTER TABLE daily_snapshot ADD COLUMN snapshot_type TEXT NOT NULL DEFAULT 'daily';

-- Backfill existing rows: a snapshot is weekly iff its date is a real BoC
-- total-assets (V36610) observation. All other rows stay 'daily' (the default).
UPDATE daily_snapshot
   SET snapshot_type = 'weekly'
 WHERE date IN (SELECT date FROM observation WHERE series_id = 'V36610');

CREATE INDEX IF NOT EXISTS idx_snapshot_type ON daily_snapshot (snapshot_type);
