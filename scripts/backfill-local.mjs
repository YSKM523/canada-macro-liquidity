/**
 * backfill-local.mjs
 * Fetches missing series (FRED + Yahoo), then computes all snapshots
 * writing directly into the Miniflare local D1 SQLite file.
 * Run: node scripts/backfill-local.mjs
 */
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/daf6b0c6bb38d170e0068ae73814ffa0a62c0851827e36f5286a322608e797fc.sqlite');

const START_DATE = '2017-01-01';

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchFredSeries(id, from) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}`;
  console.log(`  FRED ${id} from ${from}...`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED ${r.status} for ${id}`);
  const csv = await r.text();
  const lines = csv.trim().split('\n');
  return lines.slice(1).map(l => {
    const [date, raw] = l.split(',');
    return { date, value: Number(raw) };
  }).filter(o => o.date && Number.isFinite(o.value));
}

async function fetchYahooDaily(symbol, range = '10y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  console.log(`  Yahoo ${symbol}...`);
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status} for ${symbol}`);
  const json = await r.json();
  const res = json?.chart?.result?.[0];
  const ts = res?.timestamp ?? [];
  const close = res?.indicators?.quote?.[0]?.close ?? [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (typeof close[i] === 'number' && Number.isFinite(close[i]))
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), value: close[i] });
  }
  return out;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function upsertObs(db, seriesId, rows) {
  const stmt = db.prepare('INSERT OR REPLACE INTO observation (series_id, date, value) VALUES (?, ?, ?)');
  const insertMany = db.transaction((rows) => {
    for (const { date, value } of rows) stmt.run(seriesId, date, value);
  });
  insertMany(rows);
  console.log(`  Stored ${rows.length} obs for ${seriesId}`);
}

function loadSeries(db, seriesId) {
  return db.prepare('SELECT date, value FROM observation WHERE series_id = ? ORDER BY date').all(seriesId);
}

function upsertSnapshot(db, snap, tsx) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO daily_snapshot
      (date, total_assets, goc_deposits, reverse_repo, notes_circ,
       settlement_bal, netliq, netliq_trend, corra_target, goc10, goc2,
       usdcad, wti, hy_oas, vix_eod, qe_qt_regime, netliq_dir, verdict, score,
       p0, p1, p2, p3, tsx, reason, factors_json, coverage)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  stmt.run(
    snap.date, snap.total_assets, snap.goc_deposits, snap.reverse_repo, snap.notes_circ,
    snap.settlement_bal, snap.netliq, snap.netliq_trend, snap.corra_target,
    snap.goc10, snap.goc2, snap.usdcad, snap.wti, snap.hy_oas,
    null, // vix_eod (not available in CA)
    snap.qe_qt_regime, snap.netliq_dir, snap.verdict, snap.score,
    snap.p0 ? 1 : 0, snap.p1 ? 1 : 0, snap.p2 ? 1 : 0, snap.p3 ? 1 : 0,
    tsx ?? null, snap.reason, JSON.stringify(snap.factors), snap.coverage
  );
}

// ── Metrics (port of src/metrics.ts) ─────────────────────────────────────────

const WEIGHTS = {
  netliqTrend: 0.30, reserveAdequacy: 0.10, impulse: 0.08, curve: 0.12,
  dollar: 0.12, oil: 0.08, funding: 0.08, rates: 0.06, credit: 0.06,
};
const FACTOR_KEYS = ['netliqTrend','reserveAdequacy','impulse','curve','dollar','oil','funding','rates','credit'];
const COVERAGE_FACTORS = FACTOR_KEYS;
const NETLIQ_TREND_WEEKS = 13;
const VERDICT_BANDS = { bull: 55, bear: 45 };
const ASSETS_EPSILON = 500;
const CA_QT_END_DATE = '2025-03-05';

const SERIES = {
  TOTAL_ASSETS: 'V36610',
  GOC_DEPOSITS: 'V36628',
  SETTLEMENT:   'V36636',
  REVERSE_REPO: 'V1203435186',
  NOTES_CIRC:   'V36625',
  CORRA:        'AVG.INTWO',
  TARGET:       'V122514',
  GOC10:        'BD.CDN.10YR.DQ.YLD',
  GOC2:         'BD.CDN.2YR.DQ.YLD',
  USDCAD:       'FXUSDCAD',
  CADCNY:       'FXCADCNY',
  US_RATE:      'DFEDTARU',
  HY_OAS:       'BAMLH0A0HYM2',
  WTI:          'WTI',
  TSX:          '^GSPTSE',
};

function asOf(series, date) {
  let v = null;
  for (const o of series) { if (o.date <= date) v = o.value; else break; }
  return v;
}

function stats(vals) {
  const n = vals.length, m = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1)) || 1;
  return { m, sd };
}

function zScore(series, date, sign) {
  const vals = series.filter(o => o.date <= date).map(o => o.value);
  if (vals.length === 0) return 50;
  const { m, sd } = stats(vals);
  const z = (vals[vals.length - 1] - m) / sd;
  return Math.max(0, Math.min(100, 50 + sign * z * 20));
}

function scoreNetliqTrend(sb, date, weeks = NETLIQ_TREND_WEEKS) {
  const v = sb.filter(o => o.date <= date).map(o => o.value);
  if (v.length <= weeks) return 50;
  const chg = [];
  for (let i = weeks; i < v.length; i++) chg.push(v[i] - v[i - weeks]);
  if (chg.length === 0) return 50;
  const { m, sd } = stats(chg);
  const z = (chg[chg.length - 1] - m) / sd;
  return Math.max(0, Math.min(100, 50 + z * 20));
}

function scoreCurve(goc10, goc2, date) {
  const a = asOf(goc10, date), b = asOf(goc2, date);
  if (a == null || b == null) return 50;
  const slope = a - b;
  return Math.max(0, Math.min(100, 50 + slope * 20));
}

function scoreFunding(corra, target, date) {
  const a = asOf(corra, date), b = asOf(target, date);
  if (a == null || b == null) return 50;
  const spread = a - b;
  return Math.max(0, Math.min(100, 50 - spread * 200));
}

function assetsDirection(obs, date, epsilonWeeks = 4) {
  const filtered = obs.filter(o => o.date <= date);
  if (filtered.length < epsilonWeeks + 1) return 'FLAT';
  const latest = filtered[filtered.length - 1].value;
  const prev = filtered[filtered.length - 1 - epsilonWeeks].value;
  const delta = latest - prev;
  if (delta > ASSETS_EPSILON) return 'EXPANDING';
  if (delta < -ASSETS_EPSILON) return 'CONTRACTING';
  return 'FLAT';
}

function settlementDirection(score) {
  if (score > 52) return 'UP';
  if (score < 48) return 'DOWN';
  return 'FLAT';
}

function verdictFromScore(score, prev) {
  if (score > VERDICT_BANDS.bull) return 'BULLISH';
  if (score < VERDICT_BANDS.bear) return 'BEARISH';
  return prev ?? 'NEUTRAL';
}

const IMPULSE_CN = { EXPANDING: '扩表', CONTRACTING: '缩表', FLAT: '横住' };
const DIR_CN = { UP: '在升', DOWN: '在收', FLAT: '走平' };
const VERDICT_CN = { BULLISH: '偏多', BEARISH: '偏空', NEUTRAL: '中性' };

function buildReason(impulse, dir, verdict) {
  const divergence =
    (impulse === 'CONTRACTING' && dir === 'UP') ? '(缩表却放水,留意背离)' :
    (impulse === 'EXPANDING' && dir === 'DOWN') ? '(扩表却收水,留意背离)' : '';
  return `BoC ${IMPULSE_CN[impulse]}、结算余额${DIR_CN[dir]} → 环境${VERDICT_CN[verdict]}${divergence}`;
}

function computeSnapshot(m, date, prev) {
  const sbSeries      = m[SERIES.SETTLEMENT] ?? [];
  const assetsSeries  = m[SERIES.TOTAL_ASSETS] ?? [];
  const gocDepSeries  = m[SERIES.GOC_DEPOSITS] ?? [];
  const rrSeries      = m[SERIES.REVERSE_REPO] ?? [];
  const notesSeries   = m[SERIES.NOTES_CIRC] ?? [];
  const corraSeries   = m[SERIES.CORRA] ?? [];
  const targetSeries  = m[SERIES.TARGET] ?? [];
  const goc10Series   = m[SERIES.GOC10] ?? [];
  const goc2Series    = m[SERIES.GOC2] ?? [];
  const usdcadSeries  = m[SERIES.USDCAD] ?? [];
  const wtiSeries     = m[SERIES.WTI] ?? [];
  const hyOasSeries   = m[SERIES.HY_OAS] ?? [];

  const total_assets   = asOf(assetsSeries, date);
  const goc_deposits   = asOf(gocDepSeries, date);
  const reverse_repo   = asOf(rrSeries, date);
  const notes_circ     = asOf(notesSeries, date);
  const settlement_bal = asOf(sbSeries, date);
  const netliq         = settlement_bal;

  const corraVal  = asOf(corraSeries, date);
  const targetVal = asOf(targetSeries, date);
  const corra_target = (corraVal != null && targetVal != null) ? corraVal - targetVal : null;

  const goc10  = asOf(goc10Series, date);
  const goc2   = asOf(goc2Series, date);
  const usdcad = asOf(usdcadSeries, date);
  const wti    = asOf(wtiSeries, date);
  const hy_oas = asOf(hyOasSeries, date);

  const netliqTrendScore     = scoreNetliqTrend(sbSeries, date);
  const reserveAdequacyScore = zScore(sbSeries, date, 1);
  const impulseScore         = zScore(assetsSeries, date, 1);
  const curveScore           = scoreCurve(goc10Series, goc2Series, date);
  const dollarScore          = zScore(usdcadSeries, date, -1);
  const oilScore             = zScore(wtiSeries, date, 1);
  const fundingScore         = scoreFunding(corraSeries, targetSeries, date);
  const ratesScore           = zScore(goc10Series, date, -1);
  const creditScore          = zScore(hyOasSeries, date, -1);

  const factors = {
    netliqTrend:     netliqTrendScore,
    reserveAdequacy: reserveAdequacyScore,
    impulse:         impulseScore,
    curve:           curveScore,
    dollar:          dollarScore,
    oil:             oilScore,
    funding:         fundingScore,
    rates:           ratesScore,
    credit:          creditScore,
  };

  const factorSeriesMap = {
    netliqTrend:     [sbSeries],
    reserveAdequacy: [sbSeries],
    impulse:         [assetsSeries],
    curve:           [goc10Series, goc2Series],
    dollar:          [usdcadSeries],
    oil:             [wtiSeries],
    funding:         [corraSeries, targetSeries],
    rates:           [goc10Series],
    credit:          [hyOasSeries],
  };

  let covered = 0;
  for (const key of COVERAGE_FACTORS) {
    const seriesArr = factorSeriesMap[key];
    if (seriesArr.every(s => s.some(o => o.date <= date))) covered++;
  }
  const coverage = covered / COVERAGE_FACTORS.length;

  let score = 0;
  for (const k of FACTOR_KEYS) score += factors[k] * WEIGHTS[k];

  const verdict      = verdictFromScore(score, prev);
  const qe_qt_regime = assetsDirection(assetsSeries, date);
  const netliq_trend = netliqTrendScore;
  const netliq_dir   = settlementDirection(netliqTrendScore);
  const reason       = buildReason(qe_qt_regime, netliq_dir, verdict);

  const p0 = factors.rates >= 50 && factors.funding >= 50 && factors.credit >= 50;
  const p1 = factors.netliqTrend >= 50 || factors.impulse >= 50;
  const p2 = factors.dollar >= 50;
  const p3 = factors.oil >= 50;

  return {
    date, total_assets, goc_deposits, reverse_repo, notes_circ,
    settlement_bal, netliq, netliq_trend, corra_target, goc10, goc2,
    usdcad, wti, hy_oas, qe_qt_regime, netliq_dir, verdict, score,
    factors, coverage, p0, p1, p2, p3, reason,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Check if better-sqlite3 is available
  let Database;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch (e) {
    console.error('better-sqlite3 not available:', e.message);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_checkpoint(FULL)');

  const existingSeries = db.prepare('SELECT DISTINCT series_id FROM observation').all().map(r => r.series_id);
  console.log('Existing series:', existingSeries.join(', '));

  // Fetch FRED series if missing
  for (const [key, seriesId] of [['HY_OAS', 'BAMLH0A0HYM2'], ['US_RATE', 'DFEDTARU']]) {
    if (!existingSeries.includes(seriesId)) {
      console.log(`Fetching FRED ${seriesId}...`);
      const rows = await fetchFredSeries(seriesId, START_DATE);
      upsertObs(db, seriesId, rows);
    } else {
      console.log(`  ${seriesId} already present (${db.prepare('SELECT count(*) as n FROM observation WHERE series_id = ?').get(seriesId).n} rows)`);
    }
  }

  // Fetch Yahoo series if missing
  for (const [symbol, seriesId] of [['^GSPTSE', '^GSPTSE'], ['CL=F', 'WTI']]) {
    if (!existingSeries.includes(seriesId)) {
      console.log(`Fetching Yahoo ${symbol}...`);
      const rows = await fetchYahooDaily(symbol);
      upsertObs(db, seriesId, rows);
    } else {
      console.log(`  ${seriesId} already present (${db.prepare('SELECT count(*) as n FROM observation WHERE series_id = ?').get(seriesId).n} rows)`);
    }
  }

  // Load all series into memory map
  console.log('\nLoading all series into memory...');
  const m = {};
  for (const sid of Object.values(SERIES)) {
    m[sid] = db.prepare('SELECT date, value FROM observation WHERE series_id = ? ORDER BY date').all(sid);
    console.log(`  ${sid}: ${m[sid].length} obs`);
  }

  // Compute all snapshots using V36610 (total assets) dates as the weekly cadence
  const totalAssetsSeries = m[SERIES.TOTAL_ASSETS];
  const tsxSeries = m[SERIES.TSX];
  const dates = totalAssetsSeries.map(o => o.date);
  console.log(`\nComputing ${dates.length} snapshots...`);

  db.prepare('DELETE FROM daily_snapshot').run();

  const insertSnap = db.prepare(`
    INSERT OR REPLACE INTO daily_snapshot
      (date, total_assets, goc_deposits, reverse_repo, notes_circ,
       settlement_bal, netliq, netliq_trend, corra_target, goc10, goc2,
       usdcad, wti, hy_oas, vix_eod, qe_qt_regime, netliq_dir, verdict, score,
       p0, p1, p2, p3, tsx, reason, factors_json, coverage)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertAll = db.transaction((dates) => {
    let prev;
    let count = 0;
    for (const date of dates) {
      if (asOf(totalAssetsSeries, date) == null) continue;
      const snap = computeSnapshot(m, date, prev);
      const tsx = asOf(tsxSeries, date);
      insertSnap.run(
        snap.date, snap.total_assets, snap.goc_deposits, snap.reverse_repo, snap.notes_circ,
        snap.settlement_bal, snap.netliq, snap.netliq_trend, snap.corra_target,
        snap.goc10, snap.goc2, snap.usdcad, snap.wti, snap.hy_oas,
        null,
        snap.qe_qt_regime, snap.netliq_dir, snap.verdict, snap.score,
        snap.p0 ? 1 : 0, snap.p1 ? 1 : 0, snap.p2 ? 1 : 0, snap.p3 ? 1 : 0,
        tsx ?? null, snap.reason, JSON.stringify(snap.factors), snap.coverage
      );
      prev = snap.verdict;
      count++;
    }
    return count;
  });

  const count = insertAll(dates);
  console.log(`Inserted ${count} snapshots.`);

  // Update meta
  const now = new Date().toISOString();
  const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  setMeta.run('last_ingest_at', now);
  setMeta.run('last_status', 'ok');
  setMeta.run('last_error', '');
  setMeta.run('last_updated', String(db.prepare('SELECT count(*) as n FROM observation').get().n));
  setMeta.run('last_snapshots', String(count));

  db.pragma('wal_checkpoint(FULL)');
  db.close();

  console.log('\nDone! Summary:');
  console.log(`  Snapshots: ${count}`);
  console.log(`  Date range: ${dates[0]} → ${dates[dates.length - 1]}`);
}

main().catch(e => { console.error(e); process.exit(1); });
