import type { Obs, SeriesMap, Snapshot } from './metrics';
import { SERIES } from './config';

// All series IDs tracked in observations (across all sources)
const ALL_SERIES_IDS = Object.values(SERIES).map(s => s.id);

export async function maxObsDate(db: D1Database, seriesId: string): Promise<string | null> {
  const row = await db.prepare('SELECT MAX(date) AS d FROM observation WHERE series_id = ?')
    .bind(seriesId).first<{ d: string | null }>();
  return row?.d ?? null;
}

export async function upsertObservations(db: D1Database, seriesId: string, rows: Obs[]): Promise<void> {
  if (rows.length === 0) return;
  const stmt = db.prepare(
    'INSERT INTO observation (series_id, date, value) VALUES (?, ?, ?) ' +
    'ON CONFLICT(series_id, date) DO UPDATE SET value = excluded.value'
  );
  const batch = rows.map(r => stmt.bind(seriesId, r.date, r.value));
  for (let i = 0; i < batch.length; i += 100) await db.batch(batch.slice(i, i + 100));
}

export async function loadSeriesMap(db: D1Database, from = '1900-01-01'): Promise<SeriesMap> {
  const rs = await db.prepare(
    'SELECT series_id, date, value FROM observation WHERE date >= ? ORDER BY series_id, date'
  ).bind(from).all<{ series_id: string; date: string; value: number }>();
  const m: SeriesMap = {};
  for (const id of ALL_SERIES_IDS) m[id] = [];
  for (const r of rs.results ?? []) (m[r.series_id] ??= []).push({ date: r.date, value: r.value });
  return m;
}

export async function upsertSnapshot(
  db: D1Database,
  snap: Snapshot,
  tsx: number | null,
  displayVerdict: string | null = null,
  stressSource: string | null = null,   // 'live' | 'reconstructed'
): Promise<void> {
  await db.prepare(
    `INSERT INTO daily_snapshot
      (date, total_assets, goc_deposits, reverse_repo, notes_circ, settlement_bal,
       netliq, netliq_trend, corra_target, goc10, goc2, usdcad, wti, hy_oas, vix_eod,
       qe_qt_regime, netliq_dir, verdict, score, p0, p1, p2, p3, tsx,
       reason, factors_json, coverage, snapshot_type, display_verdict, stress_source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET
       total_assets=excluded.total_assets, goc_deposits=excluded.goc_deposits,
       reverse_repo=excluded.reverse_repo, notes_circ=excluded.notes_circ,
       settlement_bal=excluded.settlement_bal, netliq=excluded.netliq,
       netliq_trend=excluded.netliq_trend, corra_target=excluded.corra_target,
       goc10=excluded.goc10, goc2=excluded.goc2, usdcad=excluded.usdcad,
       wti=excluded.wti, hy_oas=excluded.hy_oas, vix_eod=excluded.vix_eod,
       qe_qt_regime=excluded.qe_qt_regime, netliq_dir=excluded.netliq_dir,
       verdict=excluded.verdict, score=excluded.score,
       p0=excluded.p0, p1=excluded.p1, p2=excluded.p2, p3=excluded.p3,
       tsx=excluded.tsx, reason=excluded.reason,
       factors_json=excluded.factors_json, coverage=excluded.coverage,
       snapshot_type=excluded.snapshot_type,
       -- never downgrade an already-captured live decision back to reconstructed
       display_verdict=CASE WHEN daily_snapshot.stress_source='live'
                            THEN daily_snapshot.display_verdict ELSE excluded.display_verdict END,
       stress_source=CASE WHEN daily_snapshot.stress_source='live'
                          THEN daily_snapshot.stress_source ELSE excluded.stress_source END`
  ).bind(
    snap.date,
    snap.total_assets,
    snap.goc_deposits,
    snap.reverse_repo,
    snap.notes_circ,
    snap.settlement_bal,
    snap.netliq,
    snap.netliq_trend,
    snap.corra_target,
    snap.goc10,
    snap.goc2,
    snap.usdcad,
    snap.wti,
    snap.hy_oas,
    null,                          // vix_eod — CA has no stored VIX series; honest null
    snap.qe_qt_regime,
    snap.netliq_dir,
    snap.verdict,
    snap.score,
    snap.p0 ? 1 : 0,
    snap.p1 ? 1 : 0,
    snap.p2 ? 1 : 0,
    snap.p3 ? 1 : 0,
    tsx,                           // tsx from function parameter (live price, not on Snapshot)
    snap.reason,
    JSON.stringify(snap.factors),  // factors_json
    snap.coverage,
    snap.snapshot_type,            // 'weekly' (canonical BoC date) | 'daily' (carry-forward)
    displayVerdict,
    stressSource,
  ).run();
}

export async function latestSnapshot(db: D1Database) {
  return db.prepare('SELECT * FROM daily_snapshot ORDER BY date DESC LIMIT 1').first();
}

export async function snapshotHistory(db: D1Database, from: string, to: string) {
  const rs = await db.prepare(
    'SELECT date, netliq, settlement_bal, score, verdict, qe_qt_regime, tsx FROM daily_snapshot WHERE date BETWEEN ? AND ? ORDER BY date'
  ).bind(from, to).all();
  return rs.results ?? [];
}

export async function snapshotOnOrBefore(db: D1Database, date: string) {
  return db.prepare('SELECT * FROM daily_snapshot WHERE date <= ? ORDER BY date DESC LIMIT 1')
    .bind(date).first();
}

export async function countSnapshots(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM daily_snapshot').first<{ n: number }>();
  return row?.n ?? 0;
}

// Backtest/robustness default to canonical WEEKLY snapshots only — mixing the
// carry-forward daily rows the cron writes pollutes IC (autocorrelation + uneven
// spacing). Pass weeklyOnly=false to include daily rows (diagnostics only).
export async function loadBacktestRows(db: D1Database, weeklyOnly = true): Promise<any[]> {
  const sql =
    'SELECT date, score, tsx, verdict, factors_json, qe_qt_regime, snapshot_type, ' +
    'usdcad, wti, display_verdict ' +   // P1: display-decision backtest inputs
    'FROM daily_snapshot WHERE tsx IS NOT NULL' +
    (weeklyOnly ? " AND snapshot_type = 'weekly'" : '') +
    ' ORDER BY date';
  const rs = await db.prepare(sql).all();
  return rs.results ?? [];
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, value).run();
}

export async function getAllMeta(db: D1Database): Promise<Record<string, string>> {
  const rs = await db.prepare('SELECT key, value FROM meta').all<{ key: string; value: string }>();
  const m: Record<string, string> = {};
  for (const r of rs.results ?? []) m[r.key] = r.value;
  return m;
}

/** Return the most recent observation value for a single series, or null if no rows exist. */
export async function latestObs(db: D1Database, seriesId: string): Promise<number | null> {
  const row = await db.prepare(
    'SELECT value FROM observation WHERE series_id = ? ORDER BY date DESC LIMIT 1'
  ).bind(seriesId).first<{ value: number }>();
  return row?.value ?? null;
}
