'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError, post } from '@/lib/api';
import type { Payment } from '@/lib/types';
import { naira } from './InspectionFee';

const WHAT: Record<Payment['type'], string> = {
  INSPECTION_FEE: 'Inspection fee',
  DEPOSIT: 'Materials deposit',
  BALANCE: 'Balance',
};

/**
 * GADMO's own stand-in for the Paystack checkout, used while testing. No money moves.
 * The API refuses it in production, where customers pay on Paystack's page.
 */
export function TestCheckout({ reference }: { reference: string }) {
  const router = useRouter();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ payment: Payment }>(`/v1/payments/test/${encodeURIComponent(reference)}`)
      .then((r) => setPayment(r.payment))
      .catch(() => setError('This test payment wasn’t found.'));
  }, [reference]);

  async function finish(outcome: 'success' | 'failed') {
    setBusy(true);
    setError(null);
    try {
      await post(`/v1/payments/test/${encodeURIComponent(reference)}/complete`, { outcome });
      router.replace(`/pay/return?reference=${encodeURIComponent(reference)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not sent. Try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Test payment</h1>
      <p className="alert alert-info">
        This is GADMO’s test checkout. No real money moves. Customers pay on Paystack once GADMO
        goes live.
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {payment && payment.status !== 'PENDING' && (
        <p className="alert alert-info">This payment is already finished.</p>
      )}
      {payment && payment.status === 'PENDING' && (
        <div className="fee-panel">
          <p className="meta">{WHAT[payment.type]}</p>
          <p className="pay-amount">{naira(payment.amountKobo)}</p>
          <div className="fee-actions">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => finish('success')}
            >
              Pay {naira(payment.amountKobo)} (test)
            </button>
            <button
              className="button button-quiet"
              type="button"
              disabled={busy}
              onClick={() => finish('failed')}
            >
              Make the payment fail
            </button>
          </div>
        </div>
      )}
    </>
  );
}
