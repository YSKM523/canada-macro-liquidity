import { describe, it, expect } from 'vitest';
import { WEIGHTS, FACTOR_KEYS, SERIES } from '../src/config';
describe('config', () => {
  it('weights sum to 1.00', () => {
    const sum = FACTOR_KEYS.reduce((s, k) => s + (WEIGHTS as any)[k], 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });
  it('has the BoC settlement-balance series', () => {
    expect(SERIES.SETTLEMENT.id).toBe('V36636');
    expect(SERIES.SETTLEMENT.source).toBe('boc');
  });
});
