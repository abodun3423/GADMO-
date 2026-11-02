import { describe, expect, it } from 'vitest';
import {
  balanceDue,
  COMMISSION_BPS,
  formatNaira,
  nairaToKobo,
  percentOf,
  splitPayout,
  validateDeposit,
  validateInspectionFee,
} from './money';

describe('money helpers', () => {
  it('converts naira to kobo without float drift', () => {
    expect(nairaToKobo(25_000)).toBe(2_500_000);
    expect(nairaToKobo(0.1 + 0.2)).toBe(30);
  });

  it('formats naira for display', () => {
    expect(formatNaira(2_500_050)).toBe('₦25,000.50');
    expect(formatNaira(5)).toBe('₦0.05');
  });

  it('rejects non-integer or negative kobo', () => {
    expect(() => formatNaira(1.5)).toThrow(RangeError);
    expect(() => percentOf(-1, 1000)).toThrow(RangeError);
    expect(() => percentOf(100, 10_001)).toThrow(RangeError);
  });

  it('rounds percentages half-up to the kobo', () => {
    expect(percentOf(1_005, 1_000)).toBe(101); // 100.5 → 101
    expect(percentOf(1_004, 1_000)).toBe(100);
  });

  it('computes the balance after inspection fee and deposit', () => {
    expect(
      balanceDue({ quoteKobo: 5_000_000, inspectionFeeKobo: 300_000, depositKobo: 2_000_000 }),
    ).toBe(2_700_000);
    expect(balanceDue({ quoteKobo: 200_000, inspectionFeeKobo: 300_000, depositKobo: 0 })).toBe(0);
  });

  it('caps the inspection fee at ₦5,000 and requires a positive amount', () => {
    expect(() => validateInspectionFee(500_000)).not.toThrow();
    expect(() => validateInspectionFee(250_000)).not.toThrow();
    expect(() => validateInspectionFee(500_001)).toThrow(/₦5,000/);
    expect(() => validateInspectionFee(0)).toThrow(RangeError);
    expect(() => validateInspectionFee(1.5)).toThrow(RangeError);
  });

  it('takes a 10% commission', () => {
    expect(COMMISSION_BPS).toBe(1_000);
    expect(splitPayout(2_700_000, COMMISSION_BPS)).toEqual({
      commissionKobo: 270_000,
      proPayoutKobo: 2_430_000,
    });
  });

  it('caps the materials deposit at 50% of the quote', () => {
    expect(() => validateDeposit(1_000_000, 500_000)).not.toThrow();
    expect(() => validateDeposit(1_000_000, 500_001)).toThrow(/50%/);
  });

  it('splits a payout so commission and Pro share always sum exactly', () => {
    for (const amount of [1, 99, 1_005, 2_700_000, 123_456_789]) {
      const { commissionKobo, proPayoutKobo } = splitPayout(amount, 1_200);
      expect(commissionKobo + proPayoutKobo).toBe(amount);
    }
    expect(splitPayout(2_700_000, 1_200)).toEqual({
      commissionKobo: 324_000,
      proPayoutKobo: 2_376_000,
    });
  });
});
