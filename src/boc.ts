export interface Obs { date: string; value: number }

export function parseValet(json: any, seriesId: string): Obs[] {
  const rows: any[] = json?.observations ?? [];
  return rows
    .filter(o => {
      const vStr = o?.[seriesId]?.v as string;
      return !!o?.d && vStr !== '' && vStr !== undefined && Number.isFinite(Number(vStr));
    })
    .map(o => ({ date: o.d as string, value: Number(o[seriesId].v) }))
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
