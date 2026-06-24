import { describe, it, expect } from 'vitest';
import { parseFredCsv, parseYahooQuote } from '../src/extsrc';
describe('extsrc parsers', () => {
  it('parses FRED CSV (header + rows, skips "." missing)', () => {
    const csv = 'observation_date,DFEDTARU\n2026-06-23,4.50\n2026-06-24,.\n';
    expect(parseFredCsv(csv)).toEqual([{ date: '2026-06-23', value: 4.5 }]);
  });
  it('reads Yahoo regularMarketPrice', () => {
    expect(parseYahooQuote({ chart: { result: [{ meta: { regularMarketPrice: 24000 } }] } })).toBe(24000);
    expect(parseYahooQuote({})).toBeNull();
  });
});
