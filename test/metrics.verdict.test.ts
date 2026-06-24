import { describe, it, expect } from 'vitest';
import { verdictFromScore, downgradeVerdict, buildGuidance } from '../src/metrics';

describe('verdict + guidance', () => {
  it('bands + hysteresis', () => {
    expect(verdictFromScore(60)).toBe('BULLISH');
    expect(verdictFromScore(40)).toBe('BEARISH');
    expect(verdictFromScore(50, 'BULLISH')).toBe('BULLISH');
  });
  it('downgrade steps one notch', () => {
    expect(downgradeVerdict('BULLISH')).toBe('NEUTRAL');
    expect(downgradeVerdict('NEUTRAL')).toBe('BEARISH');
    expect(downgradeVerdict('BEARISH')).toBe('BEARISH');
  });
  it('stress forces brake tone', () => {
    expect(buildGuidance({ score: 60, verdict: 'BULLISH', netliqDir: 'UP', qeQtRegime: 'EXPANDING', stressed: true }).tone).toBe('brake');
  });
});
