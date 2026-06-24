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

import { VERDICT_BANDS } from './config';

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
  const QT_END_DATE = '2025-03-15';
  if (date >= QT_END_DATE) return 'RESERVE_MGMT';
  if (impulse === 'EXPANDING') return 'QE';
  if (impulse === 'CONTRACTING') return 'QT';
  return 'NEUTRAL';
}
