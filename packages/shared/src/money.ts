/**
 * All money in GADMO is an integer number of kobo (₦1 = 100 kobo).
 * Never use floating-point naira for storage or calculation.
 */
export type Kobo = number;

/** Basis points: 10_000 bps = 100%. 1_200 bps = 12%. */
export type Bps = number;

/** The PRD caps a materials deposit at 50% of the quote. */
export const MAX_DEPOSIT_BPS: Bps = 5_000;

export function assertKobo(value: number, label = 'amount'): asserts value is Kobo {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative whole number of kobo`);
  }
}

export function nairaToKobo(naira: number): Kobo {
  if (!Number.isFinite(naira) || naira < 0)
    throw new RangeError('naira must be a non-negative number');
  const kobo = Math.round(naira * 100);
  assertKobo(kobo);
  return kobo;
}

export function formatNaira(kobo: Kobo): string {
  assertKobo(kobo);
  const naira = Math.floor(kobo / 100);
  const rest = String(kobo % 100).padStart(2, '0');
  return `₦${naira.toLocaleString('en-NG')}.${rest}`;
}

/** Percentage of an amount, rounded half-up to the nearest kobo. */
export function percentOf(amount: Kobo, bps: Bps): Kobo {
  assertKobo(amount);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new RangeError('bps must be a whole number between 0 and 10000');
  }
  // BigInt avoids overflow on very large amounts.
  const result = (BigInt(amount) * BigInt(bps) + 5_000n) / 10_000n;
  return Number(result);
}

export function validateDeposit(quote: Kobo, deposit: Kobo, maxBps: Bps = MAX_DEPOSIT_BPS): void {
  assertKobo(quote, 'quote');
  assertKobo(deposit, 'deposit');
  if (deposit > percentOf(quote, maxBps)) {
    throw new RangeError(`deposit cannot exceed ${maxBps / 100}% of the quote`);
  }
}

export interface BalanceInput {
  quoteKobo: Kobo;
  inspectionFeeKobo: Kobo;
  depositKobo: Kobo;
}

/** What the customer still owes after the job: quote minus what they already paid. */
export function balanceDue({ quoteKobo, inspectionFeeKobo, depositKobo }: BalanceInput): Kobo {
  assertKobo(quoteKobo, 'quote');
  assertKobo(inspectionFeeKobo, 'inspection fee');
  assertKobo(depositKobo, 'deposit');
  return Math.max(0, quoteKobo - inspectionFeeKobo - depositKobo);
}

export interface PayoutSplit {
  commissionKobo: Kobo;
  proPayoutKobo: Kobo;
}

/** Split a payment between GADMO's commission and the Pro. The two parts always add up exactly. */
export function splitPayout(amount: Kobo, commissionBps: Bps): PayoutSplit {
  const commissionKobo = percentOf(amount, commissionBps);
  return { commissionKobo, proPayoutKobo: amount - commissionKobo };
}
