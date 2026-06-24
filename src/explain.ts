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

// CA 资产负债桥:total_assets − notes_circ − goc_deposits − reverse_repo ≈ settlement_bal (= V36636)
// settlement_bal is the REAL BoC-reported V36636 figure; bridge_approx is a derived approximation
// (there are other liabilities/equity not captured by the four components).
export interface NetliqParts {
  settlement_bal: number | null;  // REAL V36636 stored value — authoritative
  total_assets: number | null;
  notes_circ: number | null;
  goc_deposits: number | null;
  reverse_repo: number | null;
  bridge_approx: number | null;   // derived: total_assets − notes_circ − goc_deposits − reverse_repo
                                  // null when any component is null; NOT the authoritative settlement_bal
}
export interface NetliqDecomp {
  current: NetliqParts;
  reference: NetliqParts | null;
  delta: NetliqParts | null;
}

function parts(
  settlement_bal: number | null,
  total_assets: number | null,
  notes_circ: number | null,
  goc_deposits: number | null,
  reverse_repo: number | null,
): NetliqParts {
  // Only compute bridge_approx when all four components are non-null
  const bridge_approx = (total_assets != null && notes_circ != null && goc_deposits != null && reverse_repo != null)
    ? total_assets - notes_circ - goc_deposits - reverse_repo
    : null;
  return { settlement_bal, total_assets, notes_circ, goc_deposits, reverse_repo, bridge_approx };
}

// settlement_bal = real V36636 (authoritative); bridge_approx is an approximation for context only.
// Δsettlement_bal and Δbridge_approx may both be null when inputs are missing.
export function decomposeNetliq(
  cur: { settlement_bal: number | null; total_assets: number | null; notes_circ: number | null; goc_deposits: number | null; reverse_repo: number | null },
  ref: { settlement_bal: number | null; total_assets: number | null; notes_circ: number | null; goc_deposits: number | null; reverse_repo: number | null } | null,
): NetliqDecomp {
  const current = parts(cur.settlement_bal, cur.total_assets, cur.notes_circ, cur.goc_deposits, cur.reverse_repo);
  if (!ref) return { current, reference: null, delta: null };
  const reference = parts(ref.settlement_bal, ref.total_assets, ref.notes_circ, ref.goc_deposits, ref.reverse_repo);
  const deltaSettlBal = (current.settlement_bal != null && reference.settlement_bal != null)
    ? current.settlement_bal - reference.settlement_bal : null;
  const deltaTotal = (current.total_assets != null && reference.total_assets != null)
    ? current.total_assets - reference.total_assets : null;
  const deltaNotes = (current.notes_circ != null && reference.notes_circ != null)
    ? current.notes_circ - reference.notes_circ : null;
  const deltaGoc = (current.goc_deposits != null && reference.goc_deposits != null)
    ? current.goc_deposits - reference.goc_deposits : null;
  const deltaRrp = (current.reverse_repo != null && reference.reverse_repo != null)
    ? current.reverse_repo - reference.reverse_repo : null;
  const deltaBridgeApprox = (deltaTotal != null && deltaNotes != null && deltaGoc != null && deltaRrp != null)
    ? deltaTotal - deltaNotes - deltaGoc - deltaRrp : null;
  const delta: NetliqParts = {
    settlement_bal: deltaSettlBal,
    total_assets:   deltaTotal,
    notes_circ:     deltaNotes,
    goc_deposits:   deltaGoc,
    reverse_repo:   deltaRrp,
    bridge_approx:  deltaBridgeApprox,
  };
  return { current, reference, delta };
}
