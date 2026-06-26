# Coverage-adjusted confidence (P1)

**Date:** 2026-06-26
**Status:** approved

## Problem

Missing factor data is currently disguised as a calm, stable neutral reading. When a
factor's required series is absent, its scorer returns **50** (neutral), so the
composite score `Σ factor × weight` is pulled toward 50 — which looks like a confident
"neutral" verdict when it really means "we can't tell." The unweighted `coverage`
count (covered / 9) is stored but not surfaced prominently, and it understates the
damage of a missing high-weight factor.

## Goal

Surface a **confidence** number next to the score so a near-50 reading backed by half
the data is visibly distinct from a genuinely neutral full-coverage reading.

**Acceptance:** the UI shows `Score 58 / confidence 0.62`, not a bare `58`.

## Design

### confidence formula (`src/metrics.ts`)

`confidence = Σ WEIGHTS[k]` over all factors `k` whose required series **all** have
≥1 observation on/before the snapshot date.

- Weights sum to 1.00, so confidence is naturally in `[0, 1]`.
- Full coverage → 1.00. Missing `netliqTrend` (.25) → 0.75. Missing `oil` (.06) → 0.94.
- This mirrors the score construction exactly: it is literally "what fraction of the
  weighted composite is backed by real signal vs filled with neutral 50."

Extract the factor → required-series mapping (currently inline in `computeSnapshot`)
into one shared module-level helper, used by both the existing unweighted `coverage`
computation and the new `computeConfidence(seriesMap, date)`, so the two never drift.

`computeConfidence` returns `{ confidence: number, missing: string[] }` — the weighted
value plus the list of factor keys lacking data (for the UI tooltip).

### on-the-fly exposure (`src/worker.ts`)

Follow the P1#2 `window_scores` precedent: the worker already loads `seriesMap`.
Compute confidence for the **current snapshot only**, expose it in `/api/snapshot` as
`snapshot.confidence` (number) and `snapshot.confidence_missing` (string[]).

- No DB migration, no backfill.
- The score value is **unchanged** (display stays 58); confidence is shown alongside.
- Verdict logic is **unchanged** — confidence is informational, not a gate (user choice).

### UI (`public/index.html`, `public/app.js`, `public/styles.css`)

Show `confidence 0.62` next to the 顺风指数 score. When confidence < 0.8, mark it with
a solid amber/warning color (solid only — no gradients) and tooltip the missing factor
list.

## Testing (TDD)

- `computeConfidence`: full coverage = 1.0; missing oil = 0.94; missing netliqTrend =
  0.75; multiple missing sums their weights; date-aware (a series that has not started
  by `date` is not counted as covered).
- `/api/snapshot` returns `confidence` equal to the weighted coverage of the latest
  snapshot.

## Out of scope

- Mutating the displayed score by coverage (would hide information).
- Gating the verdict on confidence (user chose display-only).
- Folding live-stress source coverage (Yahoo/VIX/WTI) into confidence — that already
  drives the separate UNKNOWN downgrade (P0#2); confidence is about the score's factors.
