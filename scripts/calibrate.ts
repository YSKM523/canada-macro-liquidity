/**
 * calibrate.ts
 *
 * Calibration harness for the Canada Liquidity Dashboard.
 * Imports the REAL src/ modules — no reimplementation.
 *
 * Usage:
 *   npx tsx scripts/calibrate.ts | tee scripts/calibration-output.json
 *
 * Node 18+ has global fetch. tsx handles TS imports directly.
 */

import { fetchBocSeries } from '../src/boc';
import { fetchFredSeries, fetchYahooDaily } from '../src/extsrc';
import { computeSnapshot, asOf } from '../src/metrics';
import { runBacktest } from '../src/backtest';
import { runRobustness } from '../src/robustness';
import {
  SERIES_IDS_BOC,
  SERIES_IDS_FRED,
  SERIES,
  YAHOO_SYMBOLS,
  FACTOR_KEYS,
} from '../src/config';

const START = '2017-01-01';
const RANGE = '10y';

async function main() {
  // ── 1. Fetch all series ─────────────────────────────────────────────────────
  process.stderr.write('[calibrate] Fetching BoC series...\n');
  const bocMap = await fetchBocSeries(SERIES_IDS_BOC, START);

  process.stderr.write('[calibrate] Fetching FRED series...\n');
  const fredMap: Record<string, { date: string; value: number }[]> = {};
  for (const id of SERIES_IDS_FRED) {
    process.stderr.write(`  FRED ${id}...\n`);
    fredMap[id] = await fetchFredSeries(id, START);
  }

  process.stderr.write('[calibrate] Fetching Yahoo TSX...\n');
  const tsxObs = await fetchYahooDaily(YAHOO_SYMBOLS.TSX, RANGE);

  process.stderr.write('[calibrate] Fetching Yahoo WTI...\n');
  const wtiObs = await fetchYahooDaily(YAHOO_SYMBOLS.WTI, RANGE);

  // ── 2. Build the series map (keys match ingest exactly) ─────────────────────
  // BoC: keyed by BoC id (e.g. 'V36636')
  // FRED: keyed by FRED id (e.g. 'BAMLH0A0HYM2')
  // TSX:  keyed by SERIES.TSX.id = '^GSPTSE'
  // WTI:  keyed by SERIES.WTI.id = 'WTI'  (stored as 'WTI', not 'CL=F')
  const m: Record<string, { date: string; value: number }[]> = {
    ...bocMap,
    ...fredMap,
    [SERIES.TSX.id]:  tsxObs,
    [SERIES.WTI.id]:  wtiObs,
  };

  // Log coverage
  for (const [k, v] of Object.entries(m)) {
    process.stderr.write(`  ${k}: ${v.length} obs\n`);
  }

  // ── 3. Iterate weekly dates from BoC total-assets schedule ──────────────────
  const totalAssetsSeries = m[SERIES.TOTAL_ASSETS.id];
  const tsxSeries = m[SERIES.TSX.id];

  if (!totalAssetsSeries || totalAssetsSeries.length === 0) {
    throw new Error('No total-assets series — BoC fetch failed');
  }

  process.stderr.write(`[calibrate] Computing ${totalAssetsSeries.length} snapshots...\n`);

  const rows: {
    date: string;
    score: number;
    spx: number;          // TSX price used as "spx" in backtest module
    factors: Record<string, number>;
    regime: string;
    vix: null;
  }[] = [];

  let prev: Parameters<typeof computeSnapshot>[2] = undefined;

  for (const obs of totalAssetsSeries) {
    const date = obs.date;
    const snap = computeSnapshot(m, date, prev);
    prev = snap.verdict;

    const tsx = asOf(tsxSeries, date);
    if (tsx == null) continue;   // no TSX price available — skip for backtest rows

    rows.push({
      date,
      score: snap.score,
      spx: tsx,
      factors: { ...snap.factors },
      regime: snap.qe_qt_regime,
      vix: null,
    });
  }

  process.stderr.write(`[calibrate] ${rows.length} rows with TSX prices\n`);

  // ── 4. Run backtest + robustness (same functions the worker uses) ────────────
  const btResult   = runBacktest(rows, [4, 8, 13], Array.from(FACTOR_KEYS));
  const robResult  = runRobustness(rows, { horizonWeeks: 13, iters: 2000, seed: 12345 });

  // ── 5. Output JSON provenance ─────────────────────────────────────────────────
  const output = {
    run_at: new Date().toISOString(),
    source: 'REAL src/ modules — no reimplementation',
    window: btResult.window,
    n_rows_with_tsx: rows.length,
    backtest: btResult,
    robustness: robResult,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main().catch(e => {
  process.stderr.write(`[calibrate] FATAL: ${e}\n`);
  process.exit(1);
});
