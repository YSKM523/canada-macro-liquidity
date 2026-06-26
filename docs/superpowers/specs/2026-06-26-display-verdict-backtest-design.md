# Store & backtest display_verdict (P1) + HY OAS start-date guard (P2)

**Date:** 2026-06-26
**Status:** approved

## Problem (P1)

The backtest scores the slow macro `score`, but the user actually sees
`display_verdict` — the macro verdict after the live-stress overlay (P0#1 downgrade
on a real breach, P0#2 UNKNOWN cap when ≥2 realtime sources are missing). The
stress overlay was never stored historically, and CA has no VIX. To backtest the
decision the user really acts on, we need the stress-adjusted verdict across history.

## Design (P1) — hybrid: store-forward + reconstruct-backward

### Reconstruction engine — `reconstructStress(prev, cur)` (`src/metrics.ts`)

Single source of truth for historical stress. From two adjacent weekly snapshots'
stored `tsx / usdcad / wti`, compute week-over-week % change and apply the same
`STRESS` thresholds (TSX < −4%, USDCAD > +2%, WTI < −8%). VIX is absent in CA
(`missing` starts at 1, matching live). `unknown = missing ≥ 2`. Returns
`{ stressed, unknown }`. Pure, deterministic, uses only real stored data. The
week-over-week proxy for live 5-trading-day momentum is noted in caveats.

### Store-forward (migration 0003 + ingest)

`daily_snapshot` gains `display_verdict TEXT` and `stress_source TEXT`
('live' | 'reconstructed').

At ingest, for each snapshot row:
- The current (today) snapshot uses the real live stress
  (`fetchStressSeries` → `evaluateLiveStress`) → `stress_source = 'live'`.
- Every other date uses `reconstructStress` → `stress_source = 'reconstructed'`.
- `display_verdict = displayVerdict(verdict, stressed, unknown)`.

`ON CONFLICT` must NOT downgrade an already-captured `'live'` row back to
`'reconstructed'` (CASE-preserve), so a real-time decision, once recorded, survives
later cron passes.

### Backtest — `runBacktest(snaps, { decision })` (`src/backtest.ts`)

- `BtSnap` gains `usdcad? / wti? / display_verdict?`; the worker snaps mapping adds
  these stored columns.
- `decision = 'macro'` (default): **unchanged** — IC horizons + long-flat by score>55.
- `decision = 'display'`: the long-flat position rule becomes "prefer the stored
  `display_verdict`; if absent, reconstruct via `reconstructStress`" →
  `position = display_verdict === 'BULLISH' ? 1 : 0` (macro-bullish but
  stressed/unknown ⇒ forced flat). IC section is unchanged (score is identical; only
  the decision→position mapping differs).
- Output adds a `decision` field; the display path also reports the count of weeks
  forced flat by stress, for a clean comparison against macro.

### Worker

`/api/backtest?decision=display|macro` (default `macro`, current behavior preserved).

## Design (P2) — HY OAS start-date guard

`scripts/calibrate.ts`: after loading FRED series, assert the earliest
`BAMLH0A0HYM2` (HY OAS) observation date is ≤ `START` (2017-01-01). If it starts
later, `throw` / `exit(1)` — prevents a silent credit-history break when the backtest
is rebuilt in 2026+.

## Testing (TDD)

- `reconstructStress`: TSX crash week → stressed; calm week → not stressed; a missing
  series bumps the missing count → unknown; VIX-always-absent baseline.
- `runBacktest` decision=display vs macro: a dataset that is macro-bullish through a
  sharp drawdown week → display goes flat that week (maxDD smaller, flat-weeks > 0)
  while macro stays long; decision=macro output byte-identical to current (regression).
- Default (no decision param) = macro, unchanged.
- P2: calibration throws when HY OAS first date > START; passes when ≤ START.

## Deploy

P1 needs migration 0003 + a full backfill (`?all=1`) to populate `display_verdict` /
`stress_source` across history. P2 is offline (calibration script only).

## Out of scope

- Changing the live `/api/snapshot` display_verdict (still computed fresh from live
  stress — unchanged).
- Reconstructing intraday/5-trading-day momentum exactly (weekly proxy, documented).
- Storing separate stressed/unknown columns (display_verdict encodes the decision).
