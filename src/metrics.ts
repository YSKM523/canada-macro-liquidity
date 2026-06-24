import { VERDICT_BANDS, CA_QT_END_DATE, SERIES, WEIGHTS, FACTOR_KEYS, COVERAGE_FACTORS, NETLIQ_TREND_WEEKS } from './config';

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
  const chg: number[] = [];
  for (let i = weeks; i < v.length; i++) chg.push(v[i] - v[i - weeks]);
  if (chg.length === 0) return 50;
  const { m, sd } = stats(chg);
  const z = (chg[chg.length - 1] - m) / sd;
  return Math.max(0, Math.min(100, 50 + z * 20));
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

// ── Verdict + guidance + regime (ported from US metrics, CA copy) ─────────────

export type Verdict = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export function verdictFromScore(score: number, prev?: Verdict): Verdict {
  if (score > VERDICT_BANDS.bull) return 'BULLISH';
  if (score < VERDICT_BANDS.bear) return 'BEARISH';
  return prev ?? 'NEUTRAL'; // dead-zone keeps previous verdict (hysteresis)
}

export function downgradeVerdict(v: Verdict): Verdict {
  return v === 'BULLISH' ? 'NEUTRAL' : v === 'NEUTRAL' ? 'BEARISH' : 'BEARISH';
}

export type Impulse = 'EXPANDING' | 'CONTRACTING' | 'FLAT';
export type Direction = 'UP' | 'DOWN' | 'FLAT';

const IMPULSE_CN: Record<Impulse, string> = { EXPANDING: '扩表', CONTRACTING: '缩表', FLAT: '横住' };
const DIR_CN: Record<Direction, string> = { UP: '在升', DOWN: '在收', FLAT: '走平' };
const VERDICT_CN: Record<Verdict, string> = { BULLISH: '偏多', BEARISH: '偏空', NEUTRAL: '中性' };

export function buildReason(impulse: Impulse, dir: Direction, verdict: Verdict): string {
  const divergence =
    (impulse === 'CONTRACTING' && dir === 'UP') ? '(缩表却放水,留意背离)' :
    (impulse === 'EXPANDING' && dir === 'DOWN') ? '(扩表却收水,留意背离)' : '';
  return `BoC ${IMPULSE_CN[impulse]}、结算余额${DIR_CN[dir]} → 环境${VERDICT_CN[verdict]}${divergence}`;
}

export interface GuidanceInput {
  score: number;
  verdict: string;        // macro verdict BULLISH/NEUTRAL/BEARISH
  netliqDir: string;      // 'UP' | 'DOWN' | 'FLAT'
  qeQtRegime: string;     // 'EXPANDING' | 'CONTRACTING' | 'FLAT'
  stressed: boolean;      // live_stress.stressed
}

export interface GuidanceTrigger {
  label: string;
  detail: string;
  armed: boolean;
}

export interface Guidance {
  tone: 'bull' | 'neutral' | 'bear' | 'brake';
  tierLabel: string;
  exposure: string;
  lean: string;
  divergence: string | null;
  triggers: GuidanceTrigger[];
}

export function buildGuidance(input: GuidanceInput): Guidance {
  const { score, netliqDir, qeQtRegime, stressed } = input;

  // Tier logic (ordered: stress first, then score bands)
  let tone: Guidance['tone'];
  let tierLabel: string;
  let exposure: string;
  let lean: string;

  if (stressed) {
    tone = 'brake';
    tierLabel = 'RISK-OFF · 刹车';
    exposure = '立刻停止加仓、收到基准以下';
    lean = '现金/防御,等实时风险解除';
  } else if (score >= 55) {
    if (netliqDir === 'DOWN') {
      tone = 'neutral';
      tierLabel = '偏多但留意背离';
      exposure = '基准附近偏上,别追到满仓';
      lean = 'beta 可拿但控量';
    } else {
      tone = 'bull';
      tierLabel = '顺风 · 可加码';
      exposure = '基准 +15~20pp';
      lean = 'beta/成长(XIU、高弹性)';
    }
  } else if (score < 45) {
    if (netliqDir === 'DOWN') {
      tone = 'bear';
      tierLabel = '逆风 · 减仓';
      exposure = '基准 −15~20pp';
      lean = '质量/防御、现金';
    } else {
      tone = 'bear';
      tierLabel = '偏空 · 降一档';
      exposure = '基准以下';
      lean = '质量/防御';
    }
  } else if (score < 50) {
    tone = 'neutral';
    tierLabel = '中性偏谨慎';
    exposure = '维持基准或略低';
    lean = '均衡;别上杠杆,留点干火药';
  } else {
    tone = 'neutral';
    tierLabel = '中性偏多';
    exposure = '维持基准';
    lean = '均衡';
  }

  // Divergence detection
  let divergence: string | null = null;
  if (qeQtRegime === 'EXPANDING' && netliqDir === 'DOWN') {
    divergence = 'BoC 扩表却结算余额在收:真正驱动市场的净流动性在抽水,别被 BoC 扩表骗';
  } else if (qeQtRegime === 'CONTRACTING' && netliqDir === 'UP') {
    divergence = 'BoC 缩表却结算余额在升:净流动性反在改善';
  }

  // Triggers (two fixed)
  const trigger0: GuidanceTrigger = score >= 45
    ? {
        label: '分数跌破 45 → 主动减一档',
        detail: '当前 ' + score.toFixed(1) + ',距 45 还有 ' + (score - 45).toFixed(1),
        armed: (score - 45) <= 2,
      }
    : {
        label: '分数已在 45 下方 → 维持减仓',
        detail: '当前 ' + score.toFixed(1),
        armed: true,
      };

  const trigger1: GuidanceTrigger = {
    label: '实时风险(stress)触发 → 立刻刹车',
    detail: stressed ? '已触发' : '当前未触发',
    armed: stressed,
  };

  return { tone, tierLabel, exposure, lean, divergence, triggers: [trigger0, trigger1] };
}

export type PolicyRegime = 'QE' | 'QT' | 'RESERVE_MGMT' | 'NEUTRAL';

export function policyRegime(impulse: Impulse, date: string): PolicyRegime {
  // Post-QT era: balance-sheet changes are settlement-balance management, not QE/QT
  if (date >= CA_QT_END_DATE) return 'RESERVE_MGMT';
  if (impulse === 'EXPANDING') return 'QE';
  if (impulse === 'CONTRACTING') return 'QT';
  return 'NEUTRAL';
}

// ── SeriesMap + Snapshot + computeSnapshot ────────────────────────────────────

/** Keyed by config series id strings (e.g. 'V36636', 'BAMLH0A0HYM2', 'WTI') */
export type SeriesMap = Record<string, Obs[]>;

export interface Snapshot {
  // Date
  date: string;
  // Raw BoC balance-sheet reads (null if missing)
  total_assets:   number | null;
  goc_deposits:   number | null;
  reverse_repo:   number | null;
  notes_circ:     number | null;
  settlement_bal: number | null;
  // Net liquidity (= settlement balances, not a derived formula)
  netliq:         number | null;
  netliq_trend:   number;        // scorer value 0–100
  // Market reads
  corra_target:   number | null; // CORRA – target spread (bps context, raw diff)
  goc10:          number | null;
  goc2:           number | null;
  usdcad:         number | null;
  wti:            number | null;
  hy_oas:         number | null;
  // Regime / direction
  qe_qt_regime:   Impulse;       // EXPANDING / CONTRACTING / FLAT
  netliq_dir:     Direction;     // UP / DOWN / FLAT
  // Verdict + scoring
  verdict:        Verdict;
  score:          number;
  factors:        Record<typeof FACTOR_KEYS[number], number>;
  coverage:       number;        // 0–1; fraction of COVERAGE_FACTORS with real data ≤ date
  // Pillar flags (boolean; stored as INTEGER 0/1 in daily_snapshot)
  p0: boolean; p1: boolean; p2: boolean; p3: boolean;
  reason: string;
}

/** Epsilon for total-assets 4-week change to call EXPANDING vs CONTRACTING (in M CAD) */
const ASSETS_EPSILON = 500; // $500M, conservative

/** Safe series lookup — returns [] if series not present */
function series(m: SeriesMap, id: string): Obs[] {
  return m[id] ?? [];
}

/** True if series has ≥1 observation with date ≤ d */
function hasCoverage(obs: Obs[], d: string): boolean {
  return obs.some(o => o.date <= d);
}

/** Total-assets 4wk direction */
function assetsDirection(obs: Obs[], date: string, epsilonWeeks = 4): Impulse {
  const filtered = obs.filter(o => o.date <= date);
  if (filtered.length < epsilonWeeks + 1) return 'FLAT';
  const latest = filtered[filtered.length - 1].value;
  const prev   = filtered[filtered.length - 1 - epsilonWeeks].value;
  const delta  = latest - prev;
  if (delta > ASSETS_EPSILON)  return 'EXPANDING';
  if (delta < -ASSETS_EPSILON) return 'CONTRACTING';
  return 'FLAT';
}

/** Netliq 13wk direction (UP / DOWN / FLAT) from the trend scorer */
function settlementDirection(score: number): Direction {
  if (score > 52) return 'UP';
  if (score < 48) return 'DOWN';
  return 'FLAT';
}

export function computeSnapshot(m: SeriesMap, date: string, prev?: Verdict): Snapshot {
  // ── raw reads ────────────────────────────────────────────────────────────────
  const sbSeries      = series(m, SERIES.SETTLEMENT.id);
  const assetsSeries  = series(m, SERIES.TOTAL_ASSETS.id);
  const gocDepSeries  = series(m, SERIES.GOC_DEPOSITS.id);
  const rrSeries      = series(m, SERIES.REVERSE_REPO.id);
  const notesSeries   = series(m, SERIES.NOTES_CIRC.id);
  const corraSeries   = series(m, SERIES.CORRA.id);
  const targetSeries  = series(m, SERIES.TARGET.id);
  const goc10Series   = series(m, SERIES.GOC10.id);
  const goc2Series    = series(m, SERIES.GOC2.id);
  const usdcadSeries  = series(m, SERIES.USDCAD.id);
  const wtiSeries     = series(m, SERIES.WTI.id);
  const hyOasSeries   = series(m, SERIES.HY_OAS.id);

  // Point-in-time reads
  const total_assets   = asOf(assetsSeries, date);
  const goc_deposits   = asOf(gocDepSeries, date);
  const reverse_repo   = asOf(rrSeries, date);
  const notes_circ     = asOf(notesSeries, date);
  const settlement_bal = asOf(sbSeries, date);
  const netliq         = settlement_bal;    // CA: netliq IS settlement balances

  const corraVal  = asOf(corraSeries, date);
  const targetVal = asOf(targetSeries, date);
  const corra_target = (corraVal != null && targetVal != null) ? corraVal - targetVal : null;

  const goc10  = asOf(goc10Series, date);
  const goc2   = asOf(goc2Series, date);
  const usdcad = asOf(usdcadSeries, date);
  const wti    = asOf(wtiSeries, date);
  const hy_oas = asOf(hyOasSeries, date);

  // ── 9 factor scores ──────────────────────────────────────────────────────────
  const netliqTrendScore    = scoreNetliqTrend(sbSeries, date, NETLIQ_TREND_WEEKS);
  const reserveAdequacyScore = scoreReserveAdequacy(sbSeries, date);
  const impulseScore        = scoreImpulse(assetsSeries, date);
  const curveScore          = scoreCurve(goc10Series, goc2Series, date);
  const dollarScore         = scoreDollar(usdcadSeries, date);
  const oilScore            = scoreOil(wtiSeries, date);
  const fundingScore        = scoreFunding(corraSeries, targetSeries, date);
  const ratesScore          = scoreRates(goc10Series, date);
  const creditScore         = scoreCredit(hyOasSeries, date);

  const factors: Record<typeof FACTOR_KEYS[number], number> = {
    netliqTrend:      netliqTrendScore,
    reserveAdequacy:  reserveAdequacyScore,
    impulse:          impulseScore,
    curve:            curveScore,
    dollar:           dollarScore,
    oil:              oilScore,
    funding:          fundingScore,
    rates:            ratesScore,
    credit:           creditScore,
  };

  // ── coverage (honest: missing series score 50 but decrement coverage) ────────
  // Map each factor key to the series it relies on
  const factorSeriesMap: Record<typeof FACTOR_KEYS[number], Obs[][]> = {
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
    // A factor is "covered" if ALL its required series have ≥1 obs ≤ date
    if (seriesArr.every(s => hasCoverage(s, date))) covered++;
  }
  const coverage = covered / COVERAGE_FACTORS.length;

  // ── score = Σ factor * weight ─────────────────────────────────────────────────
  let score = 0;
  for (const k of FACTOR_KEYS) {
    score += factors[k] * WEIGHTS[k];
  }

  // ── verdict + regime + direction ──────────────────────────────────────────────
  const verdict       = verdictFromScore(score, prev);
  const qe_qt_regime  = assetsDirection(assetsSeries, date);
  const netliq_trend  = netliqTrendScore;
  const netliq_dir    = settlementDirection(netliqTrendScore);

  // ── guidance text (reason) ────────────────────────────────────────────────
  const reason = buildReason(qe_qt_regime, netliq_dir, verdict);
  // guidance is computed at API response time (see /api/snapshot); not stored in DB

  // ── boolean pillar flags (stored as INTEGER 0/1 in daily_snapshot) ────────
  const p0 = factors.rates >= 50 && factors.funding >= 50 && factors.credit >= 50;
  const p1 = factors.netliqTrend >= 50 || factors.impulse >= 50;
  const p2 = factors.dollar >= 50;
  const p3 = factors.oil >= 50; // CA commodity/CAD pillar (US used vol; CA has no vol factor)

  return {
    date,
    total_assets,
    goc_deposits,
    reverse_repo,
    notes_circ,
    settlement_bal,
    netliq,
    netliq_trend,
    corra_target,
    goc10,
    goc2,
    usdcad,
    wti,
    hy_oas,
    qe_qt_regime,
    netliq_dir,
    verdict,
    score,
    factors,
    coverage,
    p0, p1, p2, p3,
    reason,
  };
}
