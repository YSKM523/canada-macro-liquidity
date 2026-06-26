import { describe, it, expect } from 'vitest';
import { assertCreditHistory } from '../src/calibration-guards';

describe('assertCreditHistory — HY OAS must cover the backtest window (P2)', () => {
  it('passes when HY OAS starts on/before START', () => {
    expect(() => assertCreditHistory([{ date: '2016-12-30', value: 4 }, { date: '2017-06-01', value: 5 }], '2017-01-01'))
      .not.toThrow();
  });

  it('passes when first obs exactly equals START', () => {
    expect(() => assertCreditHistory([{ date: '2017-01-01', value: 4 }], '2017-01-01')).not.toThrow();
  });

  it('throws when HY OAS starts AFTER START (credit history would break)', () => {
    expect(() => assertCreditHistory([{ date: '2019-03-04', value: 4 }], '2017-01-01'))
      .toThrow(/HY OAS|credit|2019-03-04/);
  });

  it('throws when HY OAS series is empty', () => {
    expect(() => assertCreditHistory([], '2017-01-01')).toThrow();
  });
});
