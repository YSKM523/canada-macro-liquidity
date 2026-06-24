import type { Env } from './service';
import { runIngest } from './service';
import { latestSnapshot, getAllMeta, countSnapshots } from './db';
import { fetchLivePrices, fetchStressSeries, evaluateLiveStress } from './prices';
import { policyRegime, downgradeVerdict, buildGuidance } from './metrics';
import { COVERAGE_FACTORS, INGEST_STALE_HOURS, STRESS_SCORE_CEILING } from './config';
import { assessHealth } from './health';

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
          return json(h, h.ok ? 200 : 503);
        } catch (e) {
          return json({ ok: false, stale: true, error: 'db_unreachable', message: String((e as any)?.message ?? e) }, 503);
        }
      }

      if (p === '/api/snapshot') {
        // Stub — filled in Task 12
        return json({ error: 'not_ready' }, 503);
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
