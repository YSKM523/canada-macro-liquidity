import { fetchBocSeries } from './boc';
import { fetchFredSeries, fetchYahooDaily } from './extsrc';
import { SERIES_IDS_BOC, SERIES_IDS_FRED, YAHOO_SYMBOLS, SERIES } from './config';
import { maxObsDate, upsertObservations, loadSeriesMap, upsertSnapshot, setMeta, countSnapshots } from './db';
import { computeSnapshot, asOf } from './metrics';
import type { Verdict } from './metrics';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
  START_DATE: string;
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function runIngest(env: Env, rebuildAll = false): Promise<{ updated: number; snapshots: number }> {
  await setMeta(env.DB, 'last_attempt_at', new Date().toISOString());
  try {
    let updated = 0;

    // 1) BoC: one multi-series call for all BoC series.
    // Use earliest maxObsDate across BoC series (or START_DATE on first run).
    const bocDates = await Promise.all(SERIES_IDS_BOC.map(id => maxObsDate(env.DB, id)));
    const bocEarliestLast = bocDates.reduce<string | null>((min, d) => {
      if (d == null) return null;           // any series missing → full pull
      if (min == null) return null;
      return d < min ? d : min;
    }, bocDates[0] ?? null);
    const bocFrom = bocEarliestLast ?? env.START_DATE;
    const bocData = await fetchBocSeries(SERIES_IDS_BOC, bocFrom);
    for (const id of SERIES_IDS_BOC) {
      const rows = bocData[id] ?? [];
      await upsertObservations(env.DB, id, rows);
      updated += rows.length;
    }

    // 2) FRED: one call per series id, incremental from maxObsDate.
    for (const id of SERIES_IDS_FRED) {
      const last = await maxObsDate(env.DB, id);
      const from = last ?? env.START_DATE;
      const rows = await fetchFredSeries(id, from);
      await upsertObservations(env.DB, id, rows);
      updated += rows.length;
    }

    // 3) Yahoo daily:
    //    TSX: fetch '^GSPTSE', store under key '^GSPTSE' (= SERIES.TSX.id)
    //    WTI: fetch 'CL=F'  , store under key 'WTI'     (= SERIES.WTI.id)
    const tsxRows = await fetchYahooDaily(YAHOO_SYMBOLS.TSX);   // symbol = '^GSPTSE'
    await upsertObservations(env.DB, SERIES.TSX.id, tsxRows);   // key    = '^GSPTSE'
    updated += tsxRows.length;

    const wtiRows = await fetchYahooDaily(YAHOO_SYMBOLS.WTI);   // symbol = 'CL=F'
    await upsertObservations(env.DB, SERIES.WTI.id, wtiRows);   // key    = 'WTI'
    updated += wtiRows.length;

    // 4) Rebuild snapshots keyed to V36610 (BoC total assets) dates.
    const m = await loadSeriesMap(env.DB);
    const totalAssetsSeries = m[SERIES.TOTAL_ASSETS.id] ?? [];  // V36610
    const tsxSeries = m[SERIES.TSX.id] ?? [];                   // '^GSPTSE'
    const lastDate = totalAssetsSeries.at(-1)?.date ?? null;
    let snapshots = 0;

    if (lastDate) {
      // rebuildAll: iterate all balance-sheet dates (weekly cadence from V36610)
      // incremental: rebuild last 14 days only
      const dates = rebuildAll
        ? totalAssetsSeries.map(o => o.date)
        : eachDay(addDays(lastDate, -14), lastDate);

      let prev: Verdict | undefined;
      for (const date of dates) {
        // Only compute snapshot if total assets has data on or before this date
        if (asOf(totalAssetsSeries, date) == null) continue;
        const snap = computeSnapshot(m, date, prev);
        await upsertSnapshot(env.DB, snap, asOf(tsxSeries, date));
        prev = snap.verdict;
        snapshots++;
      }
    }

    await setMeta(env.DB, 'last_ingest_at', new Date().toISOString());
    await setMeta(env.DB, 'last_status', 'ok');
    await setMeta(env.DB, 'last_error', '');
    await setMeta(env.DB, 'last_updated', String(updated));
    await setMeta(env.DB, 'last_snapshots', String(snapshots));
    return { updated, snapshots };
  } catch (e) {
    await setMeta(env.DB, 'last_status', 'error');
    await setMeta(env.DB, 'last_error', String((e as any)?.message ?? e));
    throw e;
  }
}
