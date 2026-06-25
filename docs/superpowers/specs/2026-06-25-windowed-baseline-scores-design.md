# Windowed baseline scores (rolling 3y / post-QT / full)

**Date:** 2026-06-25
**Status:** approved
**Problem:** Factor z-scores use the full 2017→now baseline. The 2020 COVID-QE
blowout dominates the mean/sd, so a value that is extreme *for the current
post-QT regime* reads as merely average against the 2020 tail — contaminating the
read for 2025+. We want to see the score under regime-aware baselines.

## Acceptance (from the P1)

`rolling 3y`、`post-QT baseline`、`full-history` 三套分数并列.

## Decision: on-the-fly, current snapshot only

Computed in the `/api/snapshot` response for the current date. **No schema
change, no backfill.** (User-selected over storing all three across history.)
Trade-off: no historical curve of the three variants — acceptable, the spec asks
for a side-by-side display of "now".

## Mechanic

Only the z-score **baseline distribution** is windowed; the value being scored
(latest obs ≤ date) is unchanged.

- `zScore(series, date, sign, baselineFrom?)` — when `baselineFrom` is set, mean/sd
  use only obs with `baselineFrom ≤ o.date ≤ date`.
- `changeZScore(series, date, weeks, baselineFrom?)` — same, applied to the N-week
  change distribution (a change is in-window iff its end-obs date ≥ baselineFrom).
- Thread `baselineFrom` through the 7 z/changeZ factors: dollar, oil, rates,
  credit, reserveAdequacy, netliqTrend, impulse.
- `curve` and `funding` are level spreads → window-invariant → identical across
  all three variants.

`computeWindowedScore(m, date, baselineFrom?)` recomputes the 9 factors with the
window and returns `{ score, verdict }` (weighted sum + `verdictFromScore`, no
hysteresis — these are point-in-time comparison views). The `full` variant
(`baselineFrom` undefined) must equal the stored `computeSnapshot().score`.

### Windows
- `full`: undefined (all ≤ date) — reuse the stored snapshot score for exact parity.
- `rolling3y`: `date − 3 years`.
- `postqt`: `CA_QT_END_DATE` (2025-03-05).

### Honesty guard
If a window's baseline has `< MIN_WINDOW_OBS` (26 weekly obs ≈ 6 months) the
variant returns `null` → UI shows 「样本不足」. Never emit a noisy z.

## Output (`/api/snapshot` → `snapshot.window_scores`)

```json
"window_scores": {
  "full":      { "score": 50.3, "verdict": "BEARISH" },
  "rolling3y": { "score": 47.1, "verdict": "BEARISH", "from": "2023-06-17" },
  "postqt":    { "score": 55.8, "verdict": "BULLISH", "from": "2025-03-05" }
}
```
`null` for an under-sampled variant.

## UI

A 「窗口基准对比」row under the verdict card: three scores + verdict chips, plus a
note — "rolling 3y / post-QT 排除 2020 QE 极端值对当前制度的污染".

## Tests (TDD)

1. `zScore`/`changeZScore` with `baselineFrom` use only in-window samples for the
   baseline; the scored value is unchanged.
2. **De-contamination (core):** a series with a 2020-style blowout — full-history z
   of a current high value is muted; rolling/post-QT z (blowout excluded) reads it
   as more extreme.
3. `computeWindowedScore(full)` parity == `computeSnapshot().score`.
4. Under-sampled window → `null`.

## Out of scope
Historical storage/charting of the three variants; re-weighting; changing the
canonical (`full`) score that drives the headline verdict.
