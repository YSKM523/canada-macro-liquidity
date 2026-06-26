import type { Obs } from './metrics';

/**
 * Fail calibration if the HY OAS credit series does not cover the backtest window.
 * FRED's BAMLH0A0HYM2 history is long today, but a future rebuild could silently
 * receive a truncated series — which would break the credit factor for early years
 * without any error. Guard it: the earliest observation must be ≤ START.
 */
export function assertCreditHistory(hyOasObs: Obs[], start: string): void {
  if (hyOasObs.length === 0) {
    throw new Error('[calibrate] HY OAS (BAMLH0A0HYM2) series is empty — credit history missing');
  }
  const first = hyOasObs.reduce((min, o) => (o.date < min ? o.date : min), hyOasObs[0].date);
  if (first > start) {
    throw new Error(
      `[calibrate] HY OAS (credit) starts ${first}, later than START ${start} — ` +
      `credit history would break for early backtest years. Aborting.`,
    );
  }
}
