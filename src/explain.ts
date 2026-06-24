import { WEIGHTS, COVERAGE_FACTORS } from './config';

const W = WEIGHTS as Record<string, number>;

export interface FactorContribution { key: string; factor: number; weight: number; contribution: number }

// 离中性贡献:(factor − 50) × weight;9 个权重>0 因子,Σ = 未封顶分 − 50。按 |贡献| 降序。
export function factorContributions(factors: Record<string, number>): FactorContribution[] {
  return COVERAGE_FACTORS
    .map((key) => {
      const factor = factors[key] ?? 50;
      const weight = W[key] ?? 0;
      return { key, factor, weight, contribution: (factor - 50) * weight };
    })
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export interface FactorAttribution { key: string; deltaFactor: number; weight: number; deltaContribution: number }

// 变化归因:weight × (cur − ref);Σ = 未封顶(curScore − refScore)。按 |拉动| 降序。
export function attributeScoreChange(cur: Record<string, number>, ref: Record<string, number>): FactorAttribution[] {
  return COVERAGE_FACTORS
    .map((key) => {
      const deltaFactor = (cur[key] ?? 50) - (ref[key] ?? 50);
      const weight = W[key] ?? 0;
      return { key, deltaFactor, weight, deltaContribution: weight * deltaFactor };
    })
    .sort((a, b) => Math.abs(b.deltaContribution) - Math.abs(a.deltaContribution));
}

// CA 资产负债桥:total_assets − notes_circ − goc_deposits − reverse_repo ≈ settlement_bal (= netliq)
export interface NetliqParts {
  total_assets: number;
  notes_circ: number;
  goc_deposits: number;
  reverse_repo: number;
  netliq: number;       // = total_assets − notes_circ − goc_deposits − reverse_repo
}
export interface NetliqDecomp {
  current: NetliqParts;
  reference: NetliqParts | null;
  delta: NetliqParts | null;
}

function parts(
  total_assets: number,
  notes_circ: number,
  goc_deposits: number,
  reverse_repo: number,
): NetliqParts {
  return {
    total_assets,
    notes_circ,
    goc_deposits,
    reverse_repo,
    netliq: total_assets - notes_circ - goc_deposits - reverse_repo,
  };
}

// netliq = total_assets − notes_circ − goc_deposits − reverse_repo
// Δnetliq = Δtotal_assets − Δnotes_circ − Δgoc_deposits − Δreverse_repo
export function decomposeNetliq(
  cur: { total_assets: number; notes_circ: number; goc_deposits: number; reverse_repo: number },
  ref: { total_assets: number; notes_circ: number; goc_deposits: number; reverse_repo: number } | null,
): NetliqDecomp {
  const current = parts(cur.total_assets, cur.notes_circ, cur.goc_deposits, cur.reverse_repo);
  if (!ref) return { current, reference: null, delta: null };
  const reference = parts(ref.total_assets, ref.notes_circ, ref.goc_deposits, ref.reverse_repo);
  const delta: NetliqParts = {
    total_assets: current.total_assets - reference.total_assets,
    notes_circ:   current.notes_circ   - reference.notes_circ,
    goc_deposits: current.goc_deposits - reference.goc_deposits,
    reverse_repo: current.reverse_repo - reference.reverse_repo,
    netliq:       current.netliq       - reference.netliq,
  };
  return { current, reference, delta };
}
