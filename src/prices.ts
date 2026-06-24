import { STRESS } from './config';

export interface LivePrices {
  tsx: number | null;
  vix: number | null;
  usdcad: number | null;
  wti: number | null;
  asof: string;
}

export interface StressSeries {
  tsx: number[];
  vix: number[];
  usdcad: number[];
  wti: number[];
}

export interface LiveStress {
  stressed: boolean;
  reasons: string[];
  signals: {
    vix: number | null;
    tsx5d: number | null;
    usdcad5d: number | null;
    wti5d: number | null;
  };
}

// ── Yahoo helpers ─────────────────────────────────────────────────────────────

export function parseYahooQuote(json: any): number | null {
  const p = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof p === 'number' ? p : null;
}

export function parseYahooCloses(json: any): number[] {
  const c = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  return Array.isArray(c)
    ? c.filter((x: any) => typeof x === 'number' && Number.isFinite(x))
    : [];
}

async function yahooQuote(symbol: string): Promise<number | null> {
  try {
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    return parseYahooQuote(await r.json());
  } catch {
    return null;
  }
}

async function recentCloses(symbol: string): Promise<number[]> {
  try {
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return [];
    return parseYahooCloses(await r.json());
  } catch {
    return [];
  }
}

// ── Live prices: TSX / VIX / USDCAD / WTI ────────────────────────────────────

export async function fetchLivePrices(nowIso: string): Promise<LivePrices> {
  const [tsx, vix, usdcad, wti] = await Promise.all([
    yahooQuote('^GSPTSE'),
    yahooQuote('^VIX'),
    yahooQuote('USDCAD=X'),
    yahooQuote('CL=F'),
  ]);
  return { tsx, vix, usdcad, wti, asof: nowIso };
}

// ── Stress series: recent daily closes for 5-day momentum ────────────────────

export async function fetchStressSeries(): Promise<StressSeries> {
  const [tsx, vix, usdcad, wti] = await Promise.all([
    recentCloses('^GSPTSE'),
    recentCloses('^VIX'),
    recentCloses('USDCAD=X'),
    recentCloses('CL=F'),
  ]);
  return { tsx, vix, usdcad, wti };
}

// ── Stress evaluation ─────────────────────────────────────────────────────────

export interface StressThresholds { vix: number; tsxDd: number; usdcad: number; wti: number; }

export function evaluateLiveStress(s: StressSeries, t: StressThresholds = STRESS): LiveStress {
  const last = (a: number[]): number | null => a.length ? a[a.length - 1] : null;
  const ago5 = (a: number[]): number | null =>
    a.length >= 6 ? a[a.length - 6] : (a.length ? a[0] : null);

  const vix = last(s.vix);

  const tsx_c = last(s.tsx), tsx_a = ago5(s.tsx);
  const tsx5d = (tsx_c != null && tsx_a != null && tsx_a !== 0)
    ? tsx_c / tsx_a - 1 : null;

  const fx_c = last(s.usdcad), fx_a = ago5(s.usdcad);
  const usdcad5d = (fx_c != null && fx_a != null && fx_a !== 0)
    ? fx_c / fx_a - 1 : null;

  const wti_c = last(s.wti), wti_a = ago5(s.wti);
  const wti5d = (wti_c != null && wti_a != null && wti_a !== 0)
    ? wti_c / wti_a - 1 : null;

  const reasons: string[] = [];

  if (vix != null && vix > t.vix)
    reasons.push(`VIX ${vix.toFixed(1)} > ${t.vix}（恐慌升温）`);

  if (tsx5d != null && tsx5d < t.tsxDd)
    reasons.push(`TSX 5日 ${(tsx5d * 100).toFixed(1)}%（加股急跌）`);

  // USDCAD rising = CAD weakening = stress
  if (usdcad5d != null && usdcad5d > t.usdcad)
    reasons.push(`美元/加元 5日 +${(usdcad5d * 100).toFixed(1)}%（加元贬值压力）`);

  if (wti5d != null && wti5d < t.wti)
    reasons.push(`WTI 5日 ${(wti5d * 100).toFixed(1)}%（油价暴跌，加元逆风）`);

  return {
    stressed: reasons.length > 0,
    reasons,
    signals: { vix, tsx5d, usdcad5d, wti5d },
  };
}
