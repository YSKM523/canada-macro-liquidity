import { describe, it, expect } from 'vitest';
import { parseValet } from '../src/boc';
const SAMPLE = { observations: [
  { d: '2026-06-17', V36636: { v: '68367' }, V36610: { v: '225775' } },
  { d: '2026-06-10', V36636: { v: '67000' }, V36610: { v: '226000' } },
]};
describe('parseValet', () => {
  it('extracts one series by id, newest-first input → ascending out', () => {
    expect(parseValet(SAMPLE, 'V36636')).toEqual([
      { date: '2026-06-10', value: 67000 },
      { date: '2026-06-17', value: 68367 },
    ]);
  });
  it('drops rows where the series value is missing or non-numeric', () => {
    const j = { observations: [ { d: '2026-06-17', V36636: { v: '' } }, { d: '2026-06-18', V36636: { v: '5' } } ] };
    expect(parseValet(j, 'V36636')).toEqual([{ date: '2026-06-18', value: 5 }]);
  });
});
