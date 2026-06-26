import { fetchBocSeries } from './boc';
import { fetchFredSeries, fetchYahooDaily } from './extsrc';
import { SERIES_IDS_BOC, SERIES_IDS_FRED, YAHOO_SYMBOLS, SERIES } from './config';
import { maxObsDate, upsertObservations, loadSeriesMap, upsertSnapshot, setMeta, countSnapshots } from './db';
import { computeSnapshot, asOf, reconstructStress, displayVerdict } from './metrics';
import type { Verdict, PriceRead } from './metrics';
import { fetchStressSeries, evaluateLiveStress } from './prices';

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

export async function runIngest(env: Env, rebuildAll = false): Promise<{ updated: number; snapshots: number; skipped: string[] }> {
  await setMeta(env.DB, 'last_attempt_at', new Date().toISOString());
  try {
    let updated = 0;
    const skipped: string[] = [];

    // ─── CORE: BoC Valet (load-bearing) ─────────────────────────────────────
    // V36610/V36636 drive snapshot dates + net liquidity.
    // If this throws (after retries), it IS a real error → fall to outer catch.
    const bocDates = await Promise.all(SERIES_IDS_BOC.map(id => maxObsDate(env.DB, id)));
    const bocEarliestLast = bocDates.reduce<string | null>((min, d) => {
      if (d == null) return null;           // any series missing → full pull
      if (min == null) return null;
      return d < min ? d : min;
    }, bocDates[0] ?? null);
    const bocFrom = bocEarliestLast ?? env.START_DATE;
    const bocData = await fetchBocSeries(SERIES_IDS_BOC, bocFrom);  // throws on failure
    for (const id of SERIES_IDS_BOC) {
      const rows = bocData[id] ?? [];
      await upsertObservations(env.DB, id, rows);
      updated += rows.length;
    }

    // ─── PERIPHERAL: FRED ───────────────────────────────────────────────────
    // Each series is independently wrapped — one failure doesn't abort the rest.
    for (const id of SERIES_IDS_FRED) {
      try {
        const last = await maxObsDate(env.DB, id);
        const from = last ?? env.START_DATE;
        const rows = await fetchFredSeries(id, from);
        await upsertObservations(env.DB, id, rows);
        updated += rows.length;
      } catch {
        skipped.push(`FRED:${id}`);
      }
    }

    // ─── PERIPHERAL: Yahoo ──────────────────────────────────────────────────
    // TSX: store under SERIES.TSX.id (= '^GSPTSE')
    try {
      const tsxRows = await fetchYahooDaily(YAHOO_SYMBOLS.TSX);
      await upsertObservations(env.DB, SERIES.TSX.id, tsxRows);
      updated += tsxRows.length;
    } catch {
      skipped.push(`Yahoo:${YAHOO_SYMBOLS.TSX}`);
    }

    // WTI: store under SERIES.WTI.id (= 'WTI')
    try {
      const wtiRows = await fetchYahooDaily(YAHOO_SYMBOLS.WTI);
      await upsertObservations(env.DB, SERIES.WTI.id, wtiRows);
      updated += wtiRows.length;
    } catch {
      skipped.push(`Yahoo:${YAHOO_SYMBOLS.WTI}`);
    }

    // ─── Snapshot rebuild ───────────────────────────────────────────────────
    // Only needs core BoC data (which succeeded above).
    // Peripheral series that were skipped contribute via their last-stored values
    // — the asOf() mechanic reads from DB, never fabricates.
    const m = await loadSeriesMap(env.DB);
    const totalAssetsSeries = m[SERIES.TOTAL_ASSETS.id] ?? [];  // V36610
    const tsxSeries = m[SERIES.TSX.id] ?? [];                   // '^GSPTSE'
    const lastDate = totalAssetsSeries.at(-1)?.date ?? null;
    let snapshots = 0;

    if (lastDate) {
      const dates = rebuildAll
        ? totalAssetsSeries.map(o => o.date)
        : eachDay(addDays(lastDate, -14), lastDate);

      // Live realtime stress (now) — applied only to the latest snapshot, stored as
      // the real decision the user saw. All earlier dates reconstruct from prices.
      let liveStress: { stressed: boolean; unknown: boolean } | null = null;
      try { liveStress = evaluateLiveStress(await fetchStressSeries()); } catch { liveStress = null; }

      let prev: Verdict | undefined;
      let prevPrices: PriceRead | null = null;
      for (const date of dates) {
        if (asOf(totalAssetsSeries, date) == null) continue;
        const snap = computeSnapshot(m, date, prev);
        const tsx = asOf(tsxSeries, date);
        const curPrices: PriceRead = { tsx, usdcad: snap.usdcad, wti: snap.wti };

        // display_verdict: live for the most recent date, else reconstructed week-over-week
        const isLatest = date === lastDate;
        const stress = (isLatest && liveStress)
          ? liveStress
          : (prevPrices ? reconstructStress(prevPrices, curPrices) : { stressed: false, unknown: false });
        const dVerdict = displayVerdict(snap.verdict, stress.stressed, stress.unknown);
        const source = (isLatest && liveStress) ? 'live' : 'reconstructed';

        await upsertSnapshot(env.DB, snap, tsx, dVerdict, source);
        prev = snap.verdict;
        prevPrices = curPrices;
        snapshots++;
      }
    }

    await setMeta(env.DB, 'last_ingest_at', new Date().toISOString());
    await setMeta(env.DB, 'last_status', 'ok');
    await setMeta(env.DB, 'last_error', '');
    await setMeta(env.DB, 'last_updated', String(updated));
    await setMeta(env.DB, 'last_snapshots', String(snapshots));
    await setMeta(env.DB, 'last_partial', skipped.join(','));
    return { updated, snapshots, skipped };
  } catch (e) {
    await setMeta(env.DB, 'last_status', 'error');
    await setMeta(env.DB, 'last_error', String((e as any)?.message ?? e));
    throw e;
  }
}
