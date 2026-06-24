import type { Obs } from './boc';
import { fetchRetry } from './http';

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
  const r = await fetchRetry(url);
  if (!r.ok) throw new Error(`FRED ${r.status} for ${id}`);
  return parseFredCsv(await r.text());
}

export async function fetchYahooDaily(symbol: string, range = '10y'): Promise<Obs[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const r = await fetchRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status} for ${symbol}`);
  return parseYahooCloses(await r.json());
}
