-- P1: store the stress-adjusted decision the user actually sees, for backtesting it.
-- display_verdict = displayVerdict(macro verdict, stressed, unknown).
-- stress_source: 'live' (captured from realtime stress at ingest) | 'reconstructed'
--                (rebuilt from stored week-over-week tsx/usdcad/wti). NULL until backfilled.
ALTER TABLE daily_snapshot ADD COLUMN display_verdict TEXT;
ALTER TABLE daily_snapshot ADD COLUMN stress_source TEXT;
