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
