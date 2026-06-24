import { describe, it, expect } from 'vitest';
import { evaluateLiveStress, parseYahooQuote, parseYahooCloses } from '../src/prices';

const T = { vix: 25, tsxDd: -0.04, usdcad: 0.02, wti: -0.08 };

describe('evaluateLiveStress', () => {
  it('flags a sharp CAD selloff (USDCAD +3% over 5d)', () => {
    const s = evaluateLiveStress(
      { tsx: [100,100,100,100,100,100], vix: [15], usdcad: [1.40,1.40,1.40,1.40,1.40,1.442], wti: [70,70,70,70,70,70] },
      T,
    );
    expect(s.stressed).toBe(true);
    expect(s.reasons.join()).toMatch(/美元|加元|USDCAD/);
  });

  it('calm tape → not stressed', () => {
    const s = evaluateLiveStress(
      { tsx: [100,100,100,100,100,101], vix: [15], usdcad: [1.40,1.40,1.40,1.40,1.40,1.40], wti: [70,70,70,70,70,70] },
      T,
    );
    expect(s.stressed).toBe(false);
  });

  it('high VIX triggers stress', () => {
    const s = evaluateLiveStress(
      { tsx: [100,100,100,100,100,100], vix: [30], usdcad: [1.40,1.40,1.40,1.40,1.40,1.40], wti: [70,70,70,70,70,70] },
      T,
    );
    expect(s.stressed).toBe(true);
    expect(s.reasons.join()).toMatch(/VIX/);
  });

  it('TSX sharp drawdown triggers stress', () => {
    const s = evaluateLiveStress(
      { tsx: [100,100,100,100,100,95], vix: [15], usdcad: [1.40,1.40,1.40,1.40,1.40,1.40], wti: [70,70,70,70,70,70] },
      T,
    );
    expect(s.stressed).toBe(true);
    expect(s.reasons.join()).toMatch(/TSX/);
  });

  it('WTI oil crash triggers stress', () => {
    const s = evaluateLiveStress(
      { tsx: [100,100,100,100,100,100], vix: [15], usdcad: [1.40,1.40,1.40,1.40,1.40,1.40], wti: [70,70,70,70,70,62] },
      T,
    );
    expect(s.stressed).toBe(true);
    expect(s.reasons.join()).toMatch(/WTI|油/);
  });

  it('returns signals with correct computed values', () => {
    const s = evaluateLiveStress(
      { tsx: [100,100,100,100,100,100], vix: [20], usdcad: [1.40,1.40,1.40,1.40,1.40,1.40], wti: [70,70,70,70,70,70] },
      T,
    );
    expect(s.signals.vix).toBe(20);
    expect(s.signals.tsx5d).toBeCloseTo(0, 5);
    expect(s.signals.usdcad5d).toBeCloseTo(0, 5);
    expect(s.signals.wti5d).toBeCloseTo(0, 5);
  });
});

describe('parseYahooQuote', () => {
  it('extracts regularMarketPrice', () => {
    expect(parseYahooQuote({ chart: { result: [{ meta: { regularMarketPrice: 21000 } }] } })).toBe(21000);
  });
  it('returns null for missing data', () => {
    expect(parseYahooQuote({})).toBeNull();
    expect(parseYahooQuote(null)).toBeNull();
  });
});

describe('parseYahooCloses', () => {
  it('filters nulls and returns number array', () => {
    const json = {
      chart: {
        result: [{
          indicators: { quote: [{ close: [100, null, 102, null, 104] }] },
        }],
      },
    };
    expect(parseYahooCloses(json)).toEqual([100, 102, 104]);
  });
  it('returns empty array for missing data', () => {
    expect(parseYahooCloses({})).toEqual([]);
  });
});
