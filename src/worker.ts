import type { Env } from './service';
import { runIngest } from './service';
import { latestSnapshot, getAllMeta, countSnapshots, snapshotHistory, latestObs, snapshotOnOrBefore, loadBacktestRows, loadSeriesMap } from './db';
import { factorContributions, attributeScoreChange, decomposeNetliq } from './explain';
import { fetchLivePrices, fetchStressSeries, evaluateLiveStress } from './prices';
import { policyRegime, displayVerdict, buildGuidance, computeWindowedScore, computeConfidence } from './metrics';
import { COVERAGE_FACTORS, INGEST_STALE_HOURS, SERIES, CA_QT_END_DATE } from './config';
import { assessHealth } from './health';
import { runRobustness } from './robustness';
import { runBacktest } from './backtest';
import { runWalkForward } from './walkforward';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);
      const p = url.pathname;

      if (p === '/api/health' || p === '/health') {
        try {
          const [row, meta, count] = await Promise.all([
            latestSnapshot(env.DB),
            getAllMeta(env.DB),
            countSnapshots(env.DB),
          ]);
          const h = assessHealth({
            dataDate: (row as any)?.date ?? null,
            snapshots: count,
            coverage: (row as any)?.coverage ?? null,
            lastIngestAt: meta.last_ingest_at ?? null,
            lastStatus: meta.last_status ?? null,
            lastError: meta.last_error ?? null,
            now: new Date().toISOString(),
            staleHours: INGEST_STALE_HOURS,
          });
          // partial: non-empty when peripheral sources were skipped (not a health failure)
          return json({ ...h, partial: meta.last_partial || '' }, h.ok ? 200 : 503);
        } catch (e) {
          return json({ ok: false, stale: true, error: 'db_unreachable', message: String((e as any)?.message ?? e) }, 503);
        }
      }

      if (p === '/api/history') {
        const to = url.searchParams.get('to') ?? '2100-01-01';
        const from = url.searchParams.get('from') ?? '1900-01-01';
        return json({ rows: await snapshotHistory(env.DB, from, to) });
      }

      if (p === '/api/snapshot') {
        const [row, live, stress, meta, cadcny, us_rate, corra, target, seriesMap] = await Promise.all([
          latestSnapshot(env.DB),
          fetchLivePrices(new Date().toISOString()),
          fetchStressSeries().then(s => evaluateLiveStress(s)),
          getAllMeta(env.DB),
          latestObs(env.DB, SERIES.CADCNY.id),
          latestObs(env.DB, SERIES.US_RATE.id),
          latestObs(env.DB, SERIES.CORRA.id),
          latestObs(env.DB, SERIES.TARGET.id),
          loadSeriesMap(env.DB),
        ]);
        const ingest = {
          ingest_at: meta.last_ingest_at ?? null,
          last_attempt_at: meta.last_attempt_at ?? null,
          ingest_age_hours: meta.last_ingest_at
            ? (Date.now() - Date.parse(meta.last_ingest_at)) / 3600000
            : null,
          ingest_status: meta.last_status ?? null,
          // partial: comma-separated identifiers of skipped peripheral sources (not a red alarm)
          partial: meta.last_partial || '',
        };
        const signals = { cadcny, us_rate, corra, target };
        if (!row) return json({ snapshot: null, live, ingest, signals, error: 'no_data' });
        const r: any = row;
        const display_verdict = displayVerdict(r.verdict, stress.stressed, stress.unknown);
        const guidance = buildGuidance({
          score: r.score,
          verdict: r.verdict,
          netliqDir: r.netliq_dir,
          qeQtRegime: r.qe_qt_regime,
          stressed: stress.stressed,
          unknown: stress.unknown,
        });
        // Windowed baseline scores: full (reuse stored, exact parity) + rolling 3y + post-QT.
        const d3 = new Date(r.date + 'T00:00:00Z');
        d3.setUTCFullYear(d3.getUTCFullYear() - 3);
        const rolling3yFrom = d3.toISOString().slice(0, 10);
        const window_scores = {
          full: { score: r.score, verdict: r.verdict, from: null },
          rolling3y: computeWindowedScore(seriesMap, r.date, rolling3yFrom),
          postqt: computeWindowedScore(seriesMap, r.date, CA_QT_END_DATE),
        };
        // Coverage-adjusted confidence: weighted fraction of the composite backed by
        // real data (vs missing factors filled with neutral 50). Shown next to score.
        const conf = computeConfidence(seriesMap, r.date);
        const snap = {
          ...r,
          policy_regime: policyRegime(r.qe_qt_regime, r.date),
          display_verdict,
          live_stress: stress,
          guidance,
          window_scores,
          confidence: conf.confidence,
          confidence_missing: conf.missing,
          coverage_total: COVERAGE_FACTORS.length,
        };
        return json({ snapshot: snap, live, ingest, signals });
      }

      if (p === '/api/explain') {
        const wparam = url.searchParams.get('window');
        const window = (wparam === '1m' || wparam === '3m') ? wparam : '1w';
        const days = window === '3m' ? 91 : window === '1m' ? 30 : 7;

        const cur: any = await latestSnapshot(env.DB);
        if (!cur) return json({ window, error: 'no_data' });

        const refDate = new Date(new Date(cur.date + 'T00:00:00Z').getTime() - days * 86400000)
          .toISOString().slice(0, 10);
        const refRow: any = await snapshotOnOrBefore(env.DB, refDate);
        const reference = (refRow && refRow.date !== cur.date) ? refRow : null;

        const curFactors = JSON.parse(cur.factors_json ?? '{}');
        const contributions = factorContributions(curFactors);
        const attribution = reference
          ? attributeScoreChange(curFactors, JSON.parse(reference.factors_json ?? '{}'))
          : null;
        const netliq = decomposeNetliq(
          {
            settlement_bal: cur.settlement_bal,
            total_assets:   cur.total_assets,
            notes_circ:     cur.notes_circ,
            goc_deposits:   cur.goc_deposits,
            reverse_repo:   cur.reverse_repo,
          },
          reference ? {
            settlement_bal: reference.settlement_bal,
            total_assets:   reference.total_assets,
            notes_circ:     reference.notes_circ,
            goc_deposits:   reference.goc_deposits,
            reverse_repo:   reference.reverse_repo,
          } : null,
        );

        return json({
          window,
          current: {
            date:         cur.date,
            score:        cur.score,
            netliq:       cur.netliq,
            settlement_bal: cur.settlement_bal,
            total_assets: cur.total_assets,
            notes_circ:   cur.notes_circ,
            goc_deposits: cur.goc_deposits,
            reverse_repo: cur.reverse_repo,
            tsx:          cur.tsx,
          },
          reference: reference ? {
            date:         reference.date,
            score:        reference.score,
            netliq:       reference.netliq,
            settlement_bal: reference.settlement_bal,
            total_assets: reference.total_assets,
            notes_circ:   reference.notes_circ,
            goc_deposits: reference.goc_deposits,
            reverse_repo: reference.reverse_repo,
            tsx:          reference.tsx,
          } : null,
          deltaScore: reference ? cur.score - reference.score : null,
          contributions,
          attribution,
          netliq,
        });
      }

      if (p === '/api/robustness') {
        // tsx→spx boundary mapping: CA has no SPX; TSX plays the price role.
        // vix_eod is always null in CA — the vix regime axis will be empty (rows excluded), not crash.
        const rows = await loadBacktestRows(env.DB);
        const snaps = rows
          .filter((r: any) => r.tsx != null && r.score != null && r.factors_json)
          .map((r: any) => ({
            date: r.date as string,
            score: r.score as number,
            spx: r.tsx as number,          // TSX fills the spx role
            factors: JSON.parse(r.factors_json),
            regime: r.qe_qt_regime as string | undefined,
            vix: r.vix_eod as number | null ?? undefined,
          }));
        return json(runRobustness(snaps));
      }

      if (p === '/api/backtest') {
        const rows = await loadBacktestRows(env.DB);
        const snaps = rows
          .filter((r: any) => r.tsx != null && r.score != null && r.factors_json)
          .map((r: any) => ({
            date: r.date as string,
            score: r.score as number,
            spx: r.tsx as number,          // TSX fills the spx role
            factors: JSON.parse(r.factors_json),
            regime: r.qe_qt_regime as string | undefined,
            vix: r.vix_eod as number | null ?? undefined,
          }));
        return json(runBacktest(snaps));
      }

      if (p === '/api/walkforward') {
        // Out-of-sample IC: re-fit IC weights on each training window, score the next
        // test window, compare wf-fitted vs the live WEIGHTS vs equal-weight. The honest
        // gate for any weight change — in-sample IC always looks better than it holds up.
        const rows = await loadBacktestRows(env.DB);   // weekly-only canonical snapshots
        const snaps = rows
          .filter((r: any) => r.tsx != null && r.score != null && r.factors_json)
          .map((r: any) => ({
            date: r.date as string,
            score: r.score as number,
            spx: r.tsx as number,          // TSX fills the spx role
            factors: JSON.parse(r.factors_json),
            regime: r.qe_qt_regime as string | undefined,
            vix: r.vix_eod as number | null ?? undefined,
          }));
        const hp = Number(url.searchParams.get('horizon'));
        const opts = Number.isFinite(hp) && hp > 0 ? { horizonWeeks: Math.round(hp) } : undefined;
        return json(runWalkForward(snaps, opts));
      }

      if (p === '/api/admin/refresh' && req.method === 'POST') {
        const auth = req.headers.get('authorization') ?? '';
        if (auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'unauthorized' }, 401);
        const rebuildAll = url.searchParams.get('all') === '1';
        return json(await runIngest(env, rebuildAll));
      }

      // not an API route → static assets
      return env.ASSETS.fetch(req);
    } catch (e) {
      return json({ error: 'internal', message: String((e as any)?.message ?? e) }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runIngest(env, false).then(() => undefined).catch(() => undefined));
  },
};
