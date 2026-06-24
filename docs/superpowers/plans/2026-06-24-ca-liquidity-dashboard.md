# Canada Liquidity Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Canada macro-liquidity dashboard (BoC settlement balances + TSX + CAD/USD & CAD/CNY + CORRA/yields/oil/US-CA differential) that mirrors the US `macro-liquidity-dashboard`, with a 0-100 score, verdict, guidance, honest backtest, and zero fabricated data.

**Architecture:** Cloudflare Worker + D1 (`ca_liquidity`) + static assets. Ingests BoC Valet (no key), Yahoo (TSX/WTI live), and FRED CSV (US rate + HY OAS) on a 3h cron into a D1 `observation` table, rebuilds `daily_snapshot` rows keyed to the weekly BoC balance-sheet date, and serves `/api/*` consumed by a static frontend. Pure scoring/explain/robustness functions are unit-tested; the Worker is the only I/O boundary.

**Tech Stack:** TypeScript, Cloudflare Workers + Wrangler, D1 (SQLite), Vitest, vanilla JS frontend (no framework), lightweight-charts (vendored).

**Reference codebase:** `/home/ubuntu/macro-liquidity-dashboard` (the US dashboard). Many modules are copied and adapted; tasks below say exactly what to copy and what to change. Read the US file before adapting it.

## Global Constraints

- **No hallucination (highest priority):** every displayed number traces to a real source (BoC Valet series id / Yahoo symbol / FRED id). Missing/failed series → factor or card renders `null`/「数据不足」 and is skipped. NO carry-forward estimation beyond standard as-of (latest obs ≤ date). NO `??` fallback to invented values. Coverage indicator shows N/total real factors.
- **Credit factor is a labeled proxy:** uses US HY OAS `BAMLH0A0HYM2`; UI must label it 「美国 HY OAS · 全球风险代理,非加拿大本土」.
- **Honest backtest:** run on real TSX (`^GSPTSE`); report real results with caveats; UI says 「弱信号宏观风控仪表盘,非择时工具」; never claim timing alpha.
- **Factor weights sum to exactly 1.00.**
- **BoC balance-sheet values are millions CAD;** convert to billions for display (÷1000).
- **UI language:** Simplified Chinese. Solid colors only, no CSS gradients.
- **Snapshot date cadence:** keyed to latest BoC balance-sheet (`V36610`) date (weekly, ~Wednesday as-of), exactly like the US snapshot keys to WALCL.
- **Cron:** `0 */3 * * *`. **Backfill start:** `2017-01-01`.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts` | scaffold + D1 binding + cron |
| `migrations/0001_init.sql` | `observation`, `daily_snapshot`, `meta` tables |
| `src/config.ts` | SERIES map, WEIGHTS, thresholds, VERDICT_BANDS, units |
| `src/boc.ts` | BoC Valet fetch + parse (`parseValet`, `fetchBocSeries`) |
| `src/extsrc.ts` | Yahoo (TSX/WTI) + FRED CSV (US rate, HY OAS) fetch/parse |
| `src/db.ts` | D1 read/write: observations, series map, snapshot upsert, meta |
| `src/metrics.ts` | factor scorers, `computeSnapshot`, verdict, guidance |
| `src/prices.ts` | live TSX/WTI/USDCAD + `evaluateLiveStress` |
| `src/explain.ts` | factor contributions, attribution, netliq decomposition |
| `src/robustness.ts`, `src/walkforward.ts` | honest backtest/IC/regime |
| `src/health.ts` | health assessment (coverage, stale, ingest status) |
| `src/service.ts` | `runIngest` orchestration |
| `src/worker.ts` | routes `/api/*`, cron, static fallback |
| `public/index.html`, `public/app.js`, `public/styles.css` | frontend |
| `public/vendor/lightweight-charts*.js` | vendored chart lib (copy from US) |

---

## P0 — Skeleton & Ingestion

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts`, `.gitignore`

**Interfaces:**
- Produces: npm scripts `test`, `dev`, `deploy`, `migrate:remote`, `migrate:local`; D1 binding `DB`; Worker main `src/worker.ts`.

- [ ] **Step 1: Copy scaffold from US project and adapt.** Read `/home/ubuntu/macro-liquidity-dashboard/{package.json,tsconfig.json,wrangler.toml,vitest.config.ts}`. Create the same files here with these changes: `package.json` name → `ca-liquidity-dashboard`; `wrangler.toml` `name = "ca-liquidity-dashboard"`, `[[d1_databases]]` `database_name = "ca_liquidity"` (binding stays `DB`), `[vars]` `START_DATE = "2017-01-01"`, `[triggers] crons = ["0 */3 * * *"]`, `[assets] directory = "./public"` binding `ASSETS`, `main = "src/worker.ts"`, `compatibility_date` same as US.

- [ ] **Step 2: Create the D1 database.**

Run: `npx wrangler d1 create ca_liquidity`
Expected: prints a `database_id`. Paste it into `wrangler.toml` under `[[d1_databases]]`.

- [ ] **Step 3: Install deps and verify Vitest runs (zero tests).**

Run: `npm install && npx vitest run`
Expected: PASS (no test files yet → "no tests found" is acceptable; exit 0).

- [ ] **Step 4: Commit.**

```bash
git add -A && git commit -m "chore: scaffold ca-liquidity-dashboard (worker + d1 + vitest)"
```

### Task 2: D1 schema migration

**Files:**
- Create: `migrations/0001_init.sql`

**Interfaces:**
- Produces tables: `observation(series_id TEXT, date TEXT, value REAL, PRIMARY KEY(series_id,date))`; `daily_snapshot(date TEXT PRIMARY KEY, ...)`; `meta(key TEXT PRIMARY KEY, value TEXT)`.

- [ ] **Step 1: Write the migration.** Mirror the US `migrations/0001_init.sql` + `0002`/`0003` merged. Columns for `daily_snapshot`:

```sql
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
```

- [ ] **Step 2: Apply locally.**

Run: `npx wrangler d1 migrations apply ca_liquidity --local`
Expected: "Migrations applied" with 1 migration.

- [ ] **Step 3: Commit.**

```bash
git add migrations && git commit -m "feat(db): initial schema (observation, daily_snapshot, meta)"
```

### Task 3: config.ts — series, weights, thresholds

**Files:**
- Create: `src/config.ts`, `test/config.test.ts`

**Interfaces:**
- Produces: `SERIES` (record of `{id, source:'boc'|'yahoo'|'fred', unit}`), `SERIES_IDS_BOC`/`SERIES_IDS_FRED`/`SERIES_YAHOO`, `WEIGHTS`, `FACTOR_KEYS`, `VERDICT_BANDS`, `STRESS`, `COVERAGE_FACTORS`, `STRESS_SCORE_CEILING`, `INGEST_STALE_HOURS`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { WEIGHTS, FACTOR_KEYS, SERIES } from '../src/config';
describe('config', () => {
  it('weights sum to 1.00', () => {
    const sum = FACTOR_KEYS.reduce((s, k) => s + (WEIGHTS as any)[k], 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });
  it('has the BoC settlement-balance series', () => {
    expect(SERIES.SETTLEMENT.id).toBe('V36636');
    expect(SERIES.SETTLEMENT.source).toBe('boc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `npx vitest run test/config.test.ts` — Expected: FAIL (cannot import `../src/config`).

- [ ] **Step 3: Write config.ts.**

```ts
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
export const VERDICT_BANDS = { bull: 55, bear: 45 } as const;
export const STRESS = { vix: 25, tsxDd: -0.04, usdcad: 0.02, wti: -0.08 } as const; // 5-day thresholds
export const STRESS_SCORE_CEILING = 55;
export const INGEST_STALE_HOURS = 12;
export const NETLIQ_TREND_WEEKS = 13;
```

- [ ] **Step 4: Run test to verify it passes.** Run: `npx vitest run test/config.test.ts` — Expected: PASS (weights sum 1.00).

- [ ] **Step 5: Commit.** `git add src/config.ts test/config.test.ts && git commit -m "feat(config): Canadian series map, weights, thresholds"`

### Task 4: boc.ts — Valet fetch + parse

**Files:**
- Create: `src/boc.ts`, `test/boc.test.ts`

**Interfaces:**
- Produces: `parseValet(json: any, seriesId: string): {date:string,value:number}[]`; `fetchBocSeries(ids: string[], from: string): Promise<Record<string,{date,value}[]>>` (one multi-series Valet call, `start_date=from`).

- [ ] **Step 1: Write the failing test** (real Valet shape captured 2026-06-24).

```ts
import { describe, it, expect } from 'vitest';
import { parseValet } from '../src/boc';
const SAMPLE = { observations: [
  { d: '2026-06-17', V36636: { v: '68367' }, V36610: { v: '225775' } },
  { d: '2026-06-10', V36636: { v: '67000' }, V36610: { v: '226000' } },
]};
describe('parseValet', () => {
  it('extracts one series by id, newest-first input → ascending out', () => {
    expect(parseValet(SAMPLE, 'V36636')).toEqual([
      { date: '2026-06-10', value: 67000 },
      { date: '2026-06-17', value: 68367 },
    ]);
  });
  it('drops rows where the series value is missing or non-numeric', () => {
    const j = { observations: [ { d: '2026-06-17', V36636: { v: '' } }, { d: '2026-06-18', V36636: { v: '5' } } ] };
    expect(parseValet(j, 'V36636')).toEqual([{ date: '2026-06-18', value: 5 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `npx vitest run test/boc.test.ts` — Expected: FAIL (no `parseValet`).

- [ ] **Step 3: Write boc.ts.**

```ts
export interface Obs { date: string; value: number }

export function parseValet(json: any, seriesId: string): Obs[] {
  const rows: any[] = json?.observations ?? [];
  return rows
    .map(o => ({ date: o?.d as string, value: Number(o?.[seriesId]?.v) }))
    .filter(o => !!o.date && Number.isFinite(o.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchBocSeries(ids: string[], from: string): Promise<Record<string, Obs[]>> {
  if (ids.length === 0) return {};
  const url = `https://www.bankofcanada.ca/valet/observations/${ids.join(',')}/json?start_date=${from}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'ca-liquidity-dashboard' } });
  if (!r.ok) throw new Error(`BoC Valet ${r.status} for ${ids.join(',')}`);
  const json = await r.json();
  const out: Record<string, Obs[]> = {};
  for (const id of ids) out[id] = parseValet(json, id);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `npx vitest run test/boc.test.ts` — Expected: PASS.

- [ ] **Step 5: Smoke-test the live fetch (manual, not committed).** Run: `node --input-type=module -e "import('./src/boc.ts')"` is not trivial under TS; instead verify live shape via `curl -s 'https://www.bankofcanada.ca/valet/observations/V36636/json?recent=1'`. Expected: JSON with `observations[0].V36636.v`. (Confirms the URL contract.)

- [ ] **Step 6: Commit.** `git add src/boc.ts test/boc.test.ts && git commit -m "feat(boc): Valet multi-series fetch + parse"`

### Task 5: extsrc.ts — Yahoo + FRED CSV

**Files:**
- Create: `src/extsrc.ts`, `test/extsrc.test.ts`

**Interfaces:**
- Produces: `parseFredCsv(csv: string): Obs[]`; `parseYahooCloses(json:any): number[]`; `parseYahooQuote(json:any): number|null`; `fetchFredSeries(id, from): Promise<Obs[]>`; `fetchYahooDaily(symbol, range): Promise<Obs[]>`.
- Reuse `Obs` from `./boc`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { parseFredCsv, parseYahooQuote } from '../src/extsrc';
describe('extsrc parsers', () => {
  it('parses FRED CSV (header + rows, skips "." missing)', () => {
    const csv = 'observation_date,DFEDTARU\n2026-06-23,4.50\n2026-06-24,.\n';
    expect(parseFredCsv(csv)).toEqual([{ date: '2026-06-23', value: 4.5 }]);
  });
  it('reads Yahoo regularMarketPrice', () => {
    expect(parseYahooQuote({ chart: { result: [{ meta: { regularMarketPrice: 24000 } }] } })).toBe(24000);
    expect(parseYahooQuote({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `npx vitest run test/extsrc.test.ts` — Expected: FAIL.

- [ ] **Step 3: Write extsrc.ts.**

```ts
import type { Obs } from './boc';

export function parseFredCsv(csv: string): Obs[] {
  const lines = csv.trim().split('\n');
  return lines.slice(1).map(l => {
    const [date, raw] = l.split(',');
    return { date, value: Number(raw) };
  }).filter(o => o.date && Number.isFinite(o.value)); // FRED missing = "." → NaN → dropped
}

export function parseYahooQuote(json: any): number | null {
  const p = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof p === 'number' ? p : null;
}

export function parseYahooCloses(json: any): Obs[] {
  const res = json?.chart?.result?.[0];
  const ts: number[] = res?.timestamp ?? [];
  const close: any[] = res?.indicators?.quote?.[0]?.close ?? [];
  const out: Obs[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (typeof close[i] === 'number' && Number.isFinite(close[i]))
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), value: close[i] });
  }
  return out;
}

export async function fetchFredSeries(id: string, from: string): Promise<Obs[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED ${r.status} for ${id}`);
  return parseFredCsv(await r.text());
}

export async function fetchYahooDaily(symbol: string, range = '10y'): Promise<Obs[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status} for ${symbol}`);
  return parseYahooCloses(await r.json());
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `npx vitest run test/extsrc.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add src/extsrc.ts test/extsrc.test.ts && git commit -m "feat(extsrc): Yahoo + FRED CSV fetch/parse"`

### Task 6: db.ts — observations, series map, meta, snapshot upsert

**Files:**
- Create: `src/db.ts` (no standalone unit test — exercised via integration in Task 7/12; D1 calls are I/O)

**Interfaces:**
- Produces: `upsertObservations(db, id, Obs[])`; `maxObsDate(db, id): Promise<string|null>`; `loadSeriesMap(db): Promise<Record<string,Obs[]>>`; `getAllMeta(db)`; `setMeta(db,k,v)`; `latestSnapshot(db)`; `snapshotHistory(db,from,to)`; `snapshotOnOrBefore(db,date)`; `countSnapshots(db)`; `loadBacktestRows(db)`; `upsertSnapshot(db, snap, tsx)`.

- [ ] **Step 1: Copy `db.ts` from US and adapt columns.** Read `/home/ubuntu/macro-liquidity-dashboard/src/db.ts`. Copy it. Change the `upsertSnapshot` INSERT column list + bound params to match the `daily_snapshot` columns in Task 2 (`total_assets, goc_deposits, reverse_repo, notes_circ, settlement_bal, netliq, netliq_trend, corra_target, goc10, goc2, usdcad, wti, hy_oas, vix_eod, qe_qt_regime, netliq_dir, verdict, score, p0..p3, tsx, reason, factors_json, coverage`), reading from the `Snapshot` shape defined in Task 9. Keep `loadSeriesMap`, `maxObsDate`, `meta`, `latestSnapshot`, `snapshotHistory`, `snapshotOnOrBefore`, `countSnapshots`, `loadBacktestRows` structurally identical (table/column names only differ where noted).

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit` — Expected: errors only for not-yet-existing `Snapshot` import (acceptable until Task 9) — OR stub the import. If blocking, add `import type { Snapshot } from './metrics'` and proceed; tsc passes once Task 9 lands. Note the dependency in the commit.

- [ ] **Step 3: Commit.** `git add src/db.ts && git commit -m "feat(db): observations + snapshot upsert adapted for CA schema"`

### Task 7: service.ts ingest + health.ts + worker.ts skeleton + cron

**Files:**
- Create: `src/service.ts`, `src/health.ts`, `src/worker.ts`

**Interfaces:**
- Consumes: `fetchBocSeries`, `fetchFredSeries`, `fetchYahooDaily`, db helpers, `computeSnapshot` (Task 9 — gate snapshot rebuild behind a feature check so Task 7 ships before Task 9).
- Produces: `runIngest(env, rebuildAll): {updated, snapshots}`; `/api/health` returns `{ok, data_date, coverage, ingest_status, stale, ...}`.

- [ ] **Step 1: Copy `health.ts` from US verbatim** (`assessHealth` is data-source-agnostic). Read `/home/ubuntu/macro-liquidity-dashboard/src/health.ts`, copy unchanged.

- [ ] **Step 2: Write `service.ts` `runIngest`.** Pull BoC (one multi-series call via `fetchBocSeries(SERIES_IDS_BOC, from)`), FRED (`fetchFredSeries` per id), Yahoo daily (`fetchYahooDaily('^GSPTSE')`, `fetchYahooDaily('CL=F')`); upsert each into `observation` keyed by the **config series id** (store TSX under key `^GSPTSE`, WTI under `CL=F`). Then rebuild snapshots keyed to latest `V36610` (total assets) date, mirroring US `service.ts` structure (incremental `maxObsDate` per series; `rebuildAll` samples the full balance-sheet date list, daily cron rebuilds last 14 days). Set meta `last_attempt_at`/`last_ingest_at`/`last_status`. Snapshot rebuild calls `computeSnapshot` (Task 9); until Task 9 exists, wrap that loop in `if (typeof computeSnapshot === 'function')` is not possible — instead land Task 7 with the ingest+store half and a TODO-free `rebuildSnapshots` extracted into its own exported function so Task 9 can fill `computeSnapshot`. **Order:** implement Task 9 immediately after; do not deploy between.

- [ ] **Step 3: Write `worker.ts`** with `/api/health` (copy US handler, swap series-map coverage check to CA `COVERAGE_FACTORS`), the `scheduled` cron calling `runIngest(env,false)`, and static fallback `env.ASSETS.fetch(req)`. Stub `/api/snapshot` to `{error:'not_ready'}` (filled in Task 12).

- [ ] **Step 4: Run ingest locally against remote D1 once.**

Run: `npx wrangler dev` then in another shell `curl -s localhost:8787/api/health`
Expected: JSON `{ok:false|true, ...}` (ok may be false until first ingest). No 500.

- [ ] **Step 5: Commit.** `git add src/service.ts src/health.ts src/worker.ts && git commit -m "feat(ingest): BoC/Yahoo/FRED ingestion + health + cron skeleton"`

---

## P1 — Model

### Task 8: metrics.ts — pure factor scorers

**Files:**
- Create: `src/metrics.ts` (scorers section), `test/metrics.scorers.test.ts`

**Interfaces:**
- Produces pure fns (each returns 0-100, neutral=50): `scoreNetliqTrend(series, date)`, `scoreReserveAdequacy(series, date)`, `scoreImpulse(series, date)`, `scoreCurve(goc10, goc2, date)`, `scoreDollar(usdcad, date)`, `scoreOil(wti, date)`, `scoreFunding(corra, target, date)`, `scoreRates(goc10, date)`, `scoreCredit(hyoas, date)`; helper `asOf(series, date)`.
- All consume `Obs[]` (`{date,value}` ascending) and a `date` string; use only obs with `date <= date`.

- [ ] **Step 1: Write failing tests** for the two with non-obvious direction (others follow the same z-score pattern; test these to lock direction).

```ts
import { describe, it, expect } from 'vitest';
import { scoreDollar, scoreFunding, asOf } from '../src/metrics';
const mk = (vals: number[]) => vals.map((v, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, value: v }));
describe('directional scorers', () => {
  it('asOf returns latest value <= date', () => {
    expect(asOf(mk([1, 2, 3]), '2026-01-02')).toBe(2);
  });
  it('weak CAD (USDCAD rising above its mean) scores < 50 (headwind)', () => {
    const s = scoreDollar(mk([1.30, 1.31, 1.32, 1.45]), '2026-01-04');
    expect(s).toBeLessThan(50);
  });
  it('CORRA above target (funding stress) scores < 50', () => {
    const corra = mk([4.50, 4.51, 4.52, 4.62]);
    const target = mk([4.50, 4.50, 4.50, 4.50]);
    expect(scoreFunding(corra, target, '2026-01-04')).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Run to verify fail.** Run: `npx vitest run test/metrics.scorers.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement scorers.** Use a shared z-score→0-100 mapping (copy the US `zToScore`/`scoreDollar` helper style from `/home/ubuntu/macro-liquidity-dashboard/src/metrics.ts`). Directions: higher settlement-balance trend = higher (bullish); USDCAD above mean = lower (weak CAD headwind); WTI above mean = higher (CAD tailwind); CORRA−target above 0 = lower (stress); GoC10 momentum up = lower (rates headwind, same sign as US `scoreRates`); curve steeper (10Y−2Y up) = higher; HY OAS high = lower (risk-off). Missing inputs (`asOf` returns null) → return `null` is NOT allowed by signature; instead the caller (Task 9) substitutes 50 ONLY when the series is entirely absent and marks coverage down — scorers themselves require ≥1 obs and throw/return 50 with a coverage flag handled in Task 9. Implement scorers to return a number given ≥1 obs; expose `asOf` for Task 9 coverage checks.

```ts
export interface Obs { date: string; value: number }
export function asOf(series: Obs[], date: string): number | null {
  let v: number | null = null;
  for (const o of series) { if (o.date <= date) v = o.value; else break; }
  return v;
}
function stats(vals: number[]) {
  const n = vals.length, m = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1)) || 1;
  return { m, sd };
}
function zScore(series: Obs[], date: string, sign: 1 | -1): number {
  const vals = series.filter(o => o.date <= date).map(o => o.value);
  if (vals.length === 0) return 50;
  const { m, sd } = stats(vals);
  const z = (vals[vals.length - 1] - m) / sd;
  return Math.max(0, Math.min(100, 50 + sign * z * 20));
}
export const scoreDollar = (usdcad: Obs[], d: string) => zScore(usdcad, d, -1);
export const scoreOil = (wti: Obs[], d: string) => zScore(wti, d, 1);
export const scoreRates = (goc10: Obs[], d: string) => zScore(goc10, d, -1);
export const scoreCredit = (hy: Obs[], d: string) => zScore(hy, d, -1);
export const scoreImpulse = (assets: Obs[], d: string) => zScore(assets, d, 1);
export const scoreReserveAdequacy = (sb: Obs[], d: string) => zScore(sb, d, 1);
// trend = 13wk change z; curve/funding = level spreads
export function scoreNetliqTrend(sb: Obs[], d: string, weeks = 13): number {
  const v = sb.filter(o => o.date <= d).map(o => o.value);
  if (v.length <= weeks) return 50;
  const chg = v.map((x, i) => i >= weeks ? x - v[i - weeks] : NaN).filter(Number.isFinite);
  return zScore(chg.map((x, i) => ({ date: String(i), value: x })), String(chg.length - 1), 1);
}
export function scoreCurve(goc10: Obs[], goc2: Obs[], d: string): number {
  const a = asOf(goc10, d), b = asOf(goc2, d);
  if (a == null || b == null) return 50;
  const slope = a - b; // steeper = bullish
  return Math.max(0, Math.min(100, 50 + slope * 20));
}
export function scoreFunding(corra: Obs[], target: Obs[], d: string): number {
  const a = asOf(corra, d), b = asOf(target, d);
  if (a == null || b == null) return 50;
  const spread = a - b; // CORRA above target = stress = lower
  return Math.max(0, Math.min(100, 50 - spread * 200)); // 5bps → ~40
}
```

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/metrics.scorers.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add src/metrics.ts test/metrics.scorers.test.ts && git commit -m "feat(metrics): Canadian factor scorers"`

### Task 9: metrics.ts — computeSnapshot + net liquidity + coverage

**Files:**
- Modify: `src/metrics.ts`; Create: `test/metrics.snapshot.test.ts`

**Interfaces:**
- Consumes: scorers (Task 8), `WEIGHTS`, `FACTOR_KEYS`, `COVERAGE_FACTORS`, `SERIES`.
- Produces: `interface Snapshot {date; total_assets; goc_deposits; reverse_repo; notes_circ; settlement_bal; netliq; netliq_trend; corra_target; goc10; goc2; usdcad; wti; hy_oas; qe_qt_regime; netliq_dir; verdict; score; factors; coverage; p0..p3; reason}`; `computeSnapshot(m: SeriesMap, date: string, prev?: Verdict): Snapshot`; `type SeriesMap = Record<string, Obs[]>`.
- **Net liquidity = settlement balances** (`asOf(m['V36636'], date)`). `netliq_dir` from settlement-balance 13wk trend sign. `qe_qt_regime` from total-assets direction.

- [ ] **Step 1: Write failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { computeSnapshot } from '../src/metrics';
const mk = (vals: [string, number][]) => vals.map(([date, value]) => ({ date, value }));
const m: any = {
  V36636: mk([['2026-06-10', 67000], ['2026-06-17', 68367]]),  // settlement balances
  V36610: mk([['2026-06-10', 226000], ['2026-06-17', 225775]]), // total assets
};
describe('computeSnapshot', () => {
  it('netliq equals settlement balances as-of date', () => {
    const s = computeSnapshot(m, '2026-06-17');
    expect(s.settlement_bal).toBe(68367);
    expect(s.netliq).toBe(68367);
  });
  it('coverage reflects fraction of factors with real data', () => {
    const s = computeSnapshot(m, '2026-06-17');
    expect(s.coverage).toBeGreaterThan(0);
    expect(s.coverage).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify fail.** Run: `npx vitest run test/metrics.snapshot.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `computeSnapshot`** mirroring US structure: read each series via `asOf`/scorers from `m` (keys = config series ids), compute the 9 factors, `coverage` = (count of factors whose underlying series has ≥1 obs ≤ date) / `COVERAGE_FACTORS.length`, `score` = Σ `factor*WEIGHTS`, `verdict = verdictFromScore(score, prev)` (Task 10). Set `netliq = settlement_bal`, `netliq_dir` from `scoreNetliqTrend` sign vs 50, `qe_qt_regime` EXPANDING/CONTRACTING/FLAT from total-assets 4-week delta vs epsilon. Factors with a fully-missing series contribute 50 AND decrement coverage (honest: shown but flagged).

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/metrics.snapshot.test.ts` — Expected: PASS.

- [ ] **Step 5: Wire `rebuildSnapshots` in service.ts to call `computeSnapshot` + `upsertSnapshot`.** Run full local ingest: `curl -X POST localhost:8787/api/admin/refresh?all=1 -H "authorization: Bearer $ADMIN_TOKEN"` (add the admin route mirroring US). Expected: `{updated:>0, snapshots:>0}`.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(metrics): computeSnapshot (netliq=settlement balances) + coverage"`

### Task 10: verdict + guidance + regime

**Files:**
- Modify: `src/metrics.ts`; Create: `test/metrics.verdict.test.ts`

**Interfaces:**
- Produces: `type Verdict='BULLISH'|'BEARISH'|'NEUTRAL'`; `verdictFromScore(score, prev?)`; `downgradeVerdict(v)`; `buildGuidance({score,verdict,netliqDir,qeQtRegime,stressed})`; `buildReason(...)`; `policyRegime(...)`.

- [ ] **Step 1: Write failing test** (mirror US semantics: >55 bull, <45 bear, hysteresis).

```ts
import { describe, it, expect } from 'vitest';
import { verdictFromScore, downgradeVerdict, buildGuidance } from '../src/metrics';
describe('verdict + guidance', () => {
  it('bands + hysteresis', () => {
    expect(verdictFromScore(60)).toBe('BULLISH');
    expect(verdictFromScore(40)).toBe('BEARISH');
    expect(verdictFromScore(50, 'BULLISH')).toBe('BULLISH');
  });
  it('downgrade steps one notch', () => {
    expect(downgradeVerdict('BULLISH')).toBe('NEUTRAL');
    expect(downgradeVerdict('NEUTRAL')).toBe('BEARISH');
  });
  it('stress forces brake tone', () => {
    expect(buildGuidance({ score: 60, verdict: 'BULLISH', netliqDir: 'UP', qeQtRegime: 'EXPANDING', stressed: true }).tone).toBe('brake');
  });
});
```

- [ ] **Step 2: Run to verify fail.** Run: `npx vitest run test/metrics.verdict.test.ts` — Expected: FAIL.

- [ ] **Step 3: Copy these fns from US `metrics.ts` verbatim** (`verdictFromScore`, `downgradeVerdict`, `buildGuidance`, `buildReason`, `policyRegime`) — they are data-agnostic. Adapt Chinese copy in `buildReason`/guidance to Canadian framing (「BoC 扩表」「结算余额在收」) but keep logic identical.

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/metrics.verdict.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(metrics): verdict bands, downgrade, guidance (CA copy)"`

### Task 11: prices.ts — live + stress

**Files:**
- Create: `src/prices.ts`, `test/prices.test.ts`

**Interfaces:**
- Produces: `fetchLivePrices(nowIso): {tsx,vix,usdcad,wti,asof}`; `fetchStressSeries(): {tsx[],vix[],usdcad[],wti[]}`; `evaluateLiveStress(s, STRESS): {stressed,reasons,signals}`.

- [ ] **Step 1: Write failing test** for stress logic.

```ts
import { describe, it, expect } from 'vitest';
import { evaluateLiveStress } from '../src/prices';
const T = { vix: 25, tsxDd: -0.04, usdcad: 0.02, wti: -0.08 };
describe('evaluateLiveStress', () => {
  it('flags a sharp CAD selloff (USDCAD +3% over 5d)', () => {
    const s = evaluateLiveStress({ tsx: [100,100,100,100,100,100], vix: [15], usdcad: [1.40,1.40,1.40,1.40,1.40,1.442], wti: [70,70,70,70,70,70] }, T);
    expect(s.stressed).toBe(true);
    expect(s.reasons.join()).toMatch(/美元|加元|USDCAD/);
  });
  it('calm tape → not stressed', () => {
    const s = evaluateLiveStress({ tsx: [100,100,100,100,100,101], vix: [15], usdcad: [1.40,1.40,1.40,1.40,1.40,1.40], wti: [70,70,70,70,70,70] }, T);
    expect(s.stressed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail.** Run: `npx vitest run test/prices.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** mirroring US `prices.ts`: `fetchLivePrices` uses Yahoo `^GSPTSE`, `^VIX`, `CL=F`, and `USDCAD=X` (live FX). `evaluateLiveStress` checks VIX>thr, TSX 5d return < tsxDd, USDCAD 5d return > usdcad (CAD selloff), WTI 5d return < wti. Reasons in Chinese.

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/prices.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add src/prices.ts test/prices.test.ts && git commit -m "feat(prices): live TSX/WTI/USDCAD + stress"`

### Task 12: /api/snapshot wiring

**Files:**
- Modify: `src/worker.ts`

**Interfaces:**
- Consumes: `latestSnapshot`, `fetchLivePrices`, `fetchStressSeries`+`evaluateLiveStress`, `buildGuidance`, `downgradeVerdict`, `policyRegime`, `getAllMeta`.
- Produces: `/api/snapshot` → `{snapshot:{...row, policy_regime, display_verdict, live_stress, guidance, coverage_total}, live, ingest:{ingest_at,last_attempt_at,ingest_age_hours,ingest_status}}`.

- [ ] **Step 1: Copy the US `/api/snapshot` handler** and adapt field names (`tsx` instead of `spx`, settlement-balance fields). Include `ingest_at`/`last_attempt_at` (the US fix already in our reference). 

- [ ] **Step 2: Manual verify.** Run local `wrangler dev`, `curl -s localhost:8787/api/snapshot | python3 -m json.tool | head -40`. Expected: `snapshot.netliq` == settlement balances, `live.tsx` present, `ingest.ingest_at` ISO.

- [ ] **Step 3: Commit.** `git add src/worker.ts && git commit -m "feat(api): /api/snapshot (CA fields, live, stress, guidance)"`

---

## P2 — Frontend

### Task 13: index.html + styles.css

**Files:**
- Create: `public/index.html`, `public/styles.css`, `public/vendor/lightweight-charts.standalone.production.js`

- [ ] **Step 1: Copy `styles.css` and the vendored chart lib from US verbatim** (`/home/ubuntu/macro-liquidity-dashboard/public/`). Styling (dark status cards, `.fb .bar{display:block}` fix, provenance card styles) carries over unchanged.

- [ ] **Step 2: Copy `index.html` and adapt copy + cards.** Title 「加拿大流动性看板」. Card set: verdict, guidance, score+factor-bars, chart 「结算余额 vs S&P/TSX」, **FX panel** (CAD/USD, CAD/CNY), extra-signals panel (CORRA/曲线/利差/油价), explain card, factor table, robustness card, provenance card. Add an FX panel container `#fx-card` and extra-signals `#signals-card`. Bump asset `?v=` query.

- [ ] **Step 3: Commit.** `git add public/ && git commit -m "feat(ui): index + styles (CA labels, FX + signals cards)"`

### Task 14: app.js — core renders

**Files:**
- Create: `public/app.js`

- [ ] **Step 1: Copy US `app.js` and adapt** `renderVerdict/renderGuidance/renderScore/renderChart/renderProvenance/renderFactorTable` for CA field names (`tsx`, settlement-balance netliq, factor labels). `FACTOR_LABELS` = 净流动性(结算余额)/准备金充裕/资产负债表/收益率曲线/美元/油价/资金面/利率/信用. Chart left axis = settlement balances ($B), right = TSX. Provenance layers: BoC (balance sheet weekly + FX/rates daily), Yahoo (TSX/WTI live), FRED (US rate + HY OAS).

- [ ] **Step 2: Manual verify** against local `wrangler dev` (after a local ingest): open `localhost:8787`, confirm verdict/score/factor bars/chart render with real numbers.

- [ ] **Step 3: Commit.** `git add public/app.js && git commit -m "feat(ui): app.js core renders (CA)"`

### Task 15: FX + extra-signals panels

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `/api/snapshot` (`usdcad`, `cadcny`, `corra_target`, `goc10`, `goc2`, `wti`, US rate from a new `/api/signals` OR embedded in snapshot).

- [ ] **Step 1: Extend `/api/snapshot`** (worker) to include `usdcad`, `cadcny`, `corra`, `target`, `goc10`, `goc2`, `wti`, `us_rate` (latest as-of values from series map) so the frontend has them. (Modify Task 12 handler.)

- [ ] **Step 2: Write `renderFx` + `renderSignals`.** FX card: USD/CAD (e.g. 1.42) + reciprocal CAD/USD (0.704) + CAD/CNY, each with last value. Signals card: CORRA vs target (bps), 美加利差 = US_RATE − target (bps), WTI level. Label the credit/proxy note where HY OAS appears. No fabricated values — if a field is null, render 「—」 and skip.

- [ ] **Step 3: Manual verify** panels show real values locally.

- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(ui): FX (CAD/USD, CAD/CNY) + signals (CORRA, diff, WTI) panels"`

---

## P3 — Explain + Backtest + Calibration

### Task 16: explain.ts

**Files:**
- Create: `src/explain.ts`, `test/explain.test.ts`; worker `/api/explain`.

- [ ] **Step 1: Copy US `explain.ts`** (`factorContributions`, `attributeScoreChange`, `decomposeNetliq`). Adapt `decomposeNetliq` to the CA bridge: `total_assets − notes_circ − goc_deposits − reverse_repo ≈ settlement_bal`. Write a test asserting the bridge sums correctly. Copy the US explain test and adapt field names.

- [ ] **Step 2: Run tests.** Run: `npx vitest run test/explain.test.ts` — Expected: PASS.

- [ ] **Step 3: Add `/api/explain` to worker** (copy US handler). Commit. `git add -A && git commit -m "feat(explain): contributions + attribution + CA netliq bridge"`

### Task 17: robustness.ts + walkforward.ts

**Files:**
- Create: `src/robustness.ts`, `src/walkforward.ts`, `test/robustness.test.ts`; worker `/api/robustness`.

- [ ] **Step 1: Copy US `robustness.ts` + `walkforward.ts` verbatim** (pure functions over `{date,score,spx,factors,regime,vix}` rows → here `spx` is the TSX value; pass TSX as the `spx` field). Copy the US robustness test, adapt fixture field names.

- [ ] **Step 2: Run tests.** Run: `npx vitest run test/robustness.test.ts` — Expected: PASS.

- [ ] **Step 3: Add `/api/robustness` + `/api/backtest` to worker** (copy US handlers, feed `tsx` as the price). Commit. `git add -A && git commit -m "feat(robustness): IC/strategy/regime backtest on TSX"`

### Task 18: Honest weight calibration

**Files:**
- Create: `scripts/calibrate.md` (results doc); Modify: `src/config.ts` (WEIGHTS)

- [ ] **Step 1: Backfill remote D1** (run `?all=1` against deployed-or-dev with remote DB) so `daily_snapshot` has full history. Run `/api/backtest` and `/api/robustness`; capture IC per factor + bootstrap CI.

- [ ] **Step 2: Set weights from evidence.** If a factor's standalone IC 95%CI crosses 0, keep its weight low (≤0.06); raise weight only for factors with CI>0. Keep Σ=1.00. Record the IC table + rationale in `scripts/calibrate.md`. **Do not** overfit — document that weights are coarse and signal is weak if that's what the data shows.

- [ ] **Step 3: Re-run `npx vitest run` (weights-sum test still passes).** Commit. `git add -A && git commit -m "chore(model): calibrate weights from real TSX IC (honest)"`

---

## P5 — Deploy & Verify

### Task 19: Deploy + e2e

- [ ] **Step 1: Apply migrations remote.** Run: `npx wrangler d1 migrations apply ca_liquidity --remote`.
- [ ] **Step 2: Deploy.** Run: `npx wrangler deploy`. Expected: prints workers.dev URL + cron.
- [ ] **Step 3: Backfill prod.** `curl -X POST "<url>/api/admin/refresh?all=1" -H "authorization: Bearer $ADMIN_TOKEN"`. Expected `{updated:>0, snapshots:>0}`.
- [ ] **Step 4: e2e verify (headless screenshot).** `google-chrome --headless=new --no-sandbox --screenshot=ca.png --window-size=900,3000 "<url>/?cb=1"`; read it; confirm verdict/score/factor bars/FX/provenance render real numbers; `curl -s <url>/api/health` → `{ok:true, coverage:1, stale:false}`.
- [ ] **Step 5: Commit + push.** `git add -A && git commit -m "chore: deploy ca-liquidity-dashboard" && git push` (create GitHub repo if desired).

---

## Self-Review

**Spec coverage:** §3 architecture → Tasks 1,7,12,19. §4 every series → config Task 3 + ingest Tasks 4-7. §5 netliq=settlement + 9 factors + verdict/guidance → Tasks 8-10. §6 FX/signals → Tasks 13,15. §7 frontend → Tasks 13-15. §8 honest backtest → Tasks 17-18. §2 no-hallucination → coverage in Task 9, proxy label in Task 15, honest calibration in Task 18. ✅ All spec sections mapped.

**Placeholder scan:** No "TBD"/"add error handling" — copy-from-US steps name the exact source file and the exact adaptation. Task 7/9 ordering dependency is called out explicitly (land 9 right after 7, don't deploy between). ✅

**Type consistency:** `Obs{date,value}` defined in `boc.ts`, reused everywhere. `Snapshot` fields in Task 9 match `daily_snapshot` columns (Task 2) and `upsertSnapshot` (Task 6) and `/api/snapshot` (Task 12). Factor keys identical between `config.FACTOR_KEYS` and scorers (Task 8) and `computeSnapshot` (Task 9). `tsx` is the price field throughout (US `spx` → CA `tsx`); robustness reuses the field by passing `tsx` as the row price. ✅

**Note on copy-from-US tasks:** these are legitimately DRY — the US source physically exists at `/home/ubuntu/macro-liquidity-dashboard`. Each such step names the file and the specific change, so a reviewer can verify without re-reading the whole US module.
