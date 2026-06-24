# Task 18 Report: Honest Weight Calibration

**Status:** COMPLETE  
**Date:** 2026-06-24  
**Commit:** chore(model): calibrate weights from real TSX IC (honest)

---

## Real Data Summary

| Metric | Value |
|--------|-------|
| Snapshots | 494 |
| Date range | 2017-01-04 → 2026-06-17 |
| Coverage | 1.00 (all 9 factors covered) |
| Years of history | ~9.45 |
| n_independent (13w) | 37 |

## Composite IC (13w)
- Spearman IC: **-0.067**
- Bootstrap 95% CI: **[-0.324, +0.206]** (crosses zero)
- p-value: **0.70** (not significant)

## Per-Factor IC (13w Spearman, standalone)
| Factor | IC | Direction |
|--------|----|-----------|
| netliqTrend | +0.044 | weak + |
| reserveAdequacy | +0.084 | + |
| impulse | -0.064 | - |
| curve | +0.156 | + (strongest) |
| dollar | -0.214 | - |
| oil | -0.446 | strongly - |
| funding | -0.207 | - |
| rates | +0.116 | + |
| credit | +0.114 | + |

## Weights Chosen (old → new)
| Factor | Old | New | Rationale |
|--------|-----|-----|-----------|
| netliqTrend | 0.30 | 0.25 | Structural; weakly + IC |
| reserveAdequacy | 0.10 | 0.12 | Consistent + |
| impulse | 0.08 | 0.06 | Negative IC → minimum |
| curve | 0.12 | 0.18 | Strongest + IC |
| dollar | 0.12 | 0.06 | Negative IC → minimum |
| oil | 0.08 | 0.06 | Strongly negative → minimum |
| funding | 0.08 | 0.06 | Negative IC → minimum |
| rates | 0.06 | 0.11 | Consistent + |
| credit | 0.06 | 0.10 | Consistent + |
| **Sum** | **1.00** | **1.00** | |

## Honest Verdict
Signal is WEAK. Composite IC not significant (p=0.70, n_independent=37). Four factors
(impulse, dollar, oil, funding) had negative standalone IC and were over-weighted in
the placeholder config, causing the composite IC to be negative. New weights down-weight
these factors to the minimum floor (0.06) without overfitting, as the adjustment is coarse
and respects structural priors. Dashboard should be used as a qualitative framework only.

## Tests
- 68/68 tests pass
- `npx tsc --noEmit` clean

## Files Changed
- `src/config.ts` — WEIGHTS updated with explanatory comment
- `scripts/calibrate.md` — calibration doc with full IC table, numbers, rationale
- `scripts/backfill_local.py` — local backfill utility (standalone Python, no deploy needed)
- `scripts/backfill-local.mjs` — unused (better-sqlite3 unavailable; replaced by .py)

---

## Fix: real-code calibration

**Status:** COMPLETE  
**Date:** 2026-06-24  
**Commit:** fix(calibration): recompute weights from REAL src model (drop reimplementation scripts)

### Problem fixed
`scripts/backfill-local.mjs` and `scripts/backfill_local.py` reimplemented `computeSnapshot`,
all scorers, and WEIGHTS as hardcoded copies of `src/metrics.ts`. The 494 snapshots and IC
numbers in calibrate.md were produced by a parallel copy of the model — not the shipped code.

### Fix applied
- Added `scripts/calibrate.ts`: imports REAL `src/` modules (no reimplementation). Fetches live
  data from BoC Valet, FRED, Yahoo; calls real `computeSnapshot`, `runBacktest`, `runRobustness`.
- Ran `npx tsx scripts/calibrate.ts`, committed output as `scripts/calibration-output.json`.
- Updated `scripts/calibrate.md` with real-code numbers (see Section 7 for diff).
- Updated `src/config.ts` WEIGHTS comment to reference real-code IC.
- Deleted `scripts/backfill-local.mjs` and `scripts/backfill_local.py`.
- Added `tsx` as devDependency.

### Real-code numbers (from calibration-output.json)
| Metric | Value |
|--------|-------|
| Snapshots | 494 |
| Date range | 2017-01-04 → 2026-06-17 |
| n_independent (13w) | 37 |
| Composite IC (13w Spearman) | -0.017 |
| Bootstrap 95% CI | [-0.268, +0.242] |
| p-value | 0.5585 |
| Strategy Sharpe (point) | 0.863 |
| Strategy Sharpe CI | [0.379, 1.284] |
| Max drawdown | 7.2% |

### Per-factor IC 13w (real-code)
| Factor | IC | Sign |
|--------|----|------|
| netliqTrend | +0.044 | weak + |
| reserveAdequacy | +0.084 | + |
| impulse | -0.064 | - |
| curve | +0.156 | + (strongest) |
| dollar | -0.214 | - |
| oil | -0.446 | strongly - |
| funding | -0.207 | - |
| rates | +0.116 | + |
| credit | +0.095 | + |

### Weights changed?
NO. Per-factor IC signs are identical to prior run. Composite IC changed from -0.067 to -0.017
(both near zero, both insignificant). The calibration conclusions — which factors to up/down-weight —
are unchanged. Weights in `src/config.ts` remain as set by the previous commit (Σ=1.00).

### Test results
- vitest: 68/68 pass
- tsc --noEmit: clean

---

## Final fix-wave

**Status:** COMPLETE
**Date:** 2026-06-24
**Commit:** fix(review): explain card shows real V36636 (null-guarded) + final tidy-ups

### Fix I1 — /api/explain settlement balance card shows real V36636 (honesty)
- `src/explain.ts`: rewrote `NetliqParts` to carry `settlement_bal` (real V36636) as the authoritative field and renamed the derived sum to `bridge_approx` (null-guarded: null when any component is null, never 0).
- `src/explain.ts`: `decomposeNetliq` now accepts `settlement_bal` in both cur/ref, propagates it through current/reference/delta objects.
- `src/worker.ts`: passes `settlement_bal: cur.settlement_bal` and `settlement_bal: reference.settlement_bal` into `decomposeNetliq`.
- `public/app.js`: `renderSettlementBal` shows real V36636 as headline; bridge rows labeled "资产负债表构成（近似桥接）" with explanatory note; null renders as 「数据不足」, never 0.
- `test/explain.test.ts`: added 6 new assertions: real `settlement_bal` passes through (not derived sum), null component → `bridge_approx` is null, null ref settlement_bal → delta null; updated bridge arithmetic test to point at `bridge_approx`.

### Fix M1 — export:snapshots SQL uses correct column names
- `package.json`: changed `spx` → `tsx`, dropped `vix_eod` (CA always-null), no US-only columns.

### Fix M2 — dead buildGuidance call removed from computeSnapshot
- `src/metrics.ts`: removed orphaned `buildGuidance({...})` call whose result was discarded; kept the explanatory comment.

### Fix M5 — FX/signals panels styled
- `public/styles.css`: added `.fx-row`, `.fx-label`, `.fx-val`, `.sig-row`, `.sig-label`, `.sig-val` — flex row, label muted-color left, value tabular-nums right, border-bottom row separator, consistent with existing card aesthetic. Solid colors only.

### Fix M7 — stray log artifact removed
- `git rm scripts/calibrate-stderr.txt`
- `.gitignore`: added `scripts/*-stderr.txt`

### Test command / output
```
npx vitest run   →  71 passed (9 files), 0 failed
npx tsc --noEmit →  (no output, clean)
node --check public/app.js → (no output, clean)
```
