import { describe, it, expect } from 'vitest';
import { verdictFromScore, downgradeVerdict, displayVerdict, buildGuidance } from '../src/metrics';

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

  describe('displayVerdict — live stress must never show bullish', () => {
    it('P0: stressed + bullish (score 60) → never BULLISH', () => {
      // score 60 → verdictFromScore = BULLISH; under a live stress event the
      // headline must downgrade regardless of how high the macro score is.
      expect(verdictFromScore(60)).toBe('BULLISH');
      const shown = displayVerdict('BULLISH', true);
      expect(shown).not.toBe('BULLISH');
      expect(['NEUTRAL', 'BEARISH']).toContain(shown);
    });
    it('stressed downgrades one notch across all verdicts', () => {
      expect(displayVerdict('BULLISH', true)).toBe('NEUTRAL');
      expect(displayVerdict('NEUTRAL', true)).toBe('BEARISH');
      expect(displayVerdict('BEARISH', true)).toBe('BEARISH');
    });
    it('no stress leaves the macro verdict untouched', () => {
      expect(displayVerdict('BULLISH', false)).toBe('BULLISH');
      expect(displayVerdict('NEUTRAL', false)).toBe('NEUTRAL');
      expect(displayVerdict('BEARISH', false)).toBe('BEARISH');
    });
  });

  describe('displayVerdict — UNKNOWN (live data missing) caps the upside', () => {
    it('P0: unknown caps BULLISH → NEUTRAL (no pure bullish when blind)', () => {
      expect(displayVerdict('BULLISH', false, true)).toBe('NEUTRAL');
    });
    it('unknown is "we cannot tell", not risk → never pushes to BEARISH', () => {
      expect(displayVerdict('NEUTRAL', false, true)).toBe('NEUTRAL');
      expect(displayVerdict('BEARISH', false, true)).toBe('BEARISH');
    });
    it('a real stress breach still outranks unknown (full downgrade)', () => {
      expect(displayVerdict('BULLISH', true, true)).toBe('NEUTRAL');
      expect(displayVerdict('NEUTRAL', true, true)).toBe('BEARISH');
    });
    it('all data present → unchanged', () => {
      expect(displayVerdict('BULLISH', false, false)).toBe('BULLISH');
    });
  });
});
