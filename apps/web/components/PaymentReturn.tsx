'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import type { Payment } from '@/lib/types';
import { naira } from './InspectionFee';

const CHECKS = 10;
const CHECK_EVERY_MS = 3000;

/** Confirms the payment with GADMO (which asks the payment provider) and shows the outcome. */
export function PaymentReturn({ reference }: { reference: string }) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check(attempt: number) {
      try {
        const res = await post<{ payment: Payment }>(
          `/v1/payments/${encodeURIComponent(reference)}/check`,
        );
        if (stopped) return;
        setPayment(res.payment);
        if (res.payment.status !== 'PENDING') return;
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
          setError('This payment wasn’t found.');
          return;
        }
      }
      if (attempt + 1 >= CHECKS) setGaveUp(true);
      else timer = setTimeout(() => void check(attempt + 1), CHECK_EVERY_MS);
    }
    void check(0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [reference]);

  const back = payment ? (
    <Link className="button" href={`/jobs/${payment.jobId}`}>
      Back to the job chat
    </Link>
  ) : null;

  if (error) {
    return (
      <>
        <h1 className="page-title">Payment</h1>
        <p className="alert alert-error" role="alert">
          {error}
        </p>
        <Link className="button" href="/jobs">
          Go to My jobs
        </Link>
      </>
    );
  }
  if (payment?.status === 'SUCCEEDED') {
    return (
      <>
        <h1 className="page-title">Payment received</h1>
        <p className="alert alert-ok" role="status">
          {payment.type === 'DEPOSIT'
            ? `${naira(payment.amountKobo)} deposit paid and your quote is accepted. The deposit goes to your Pro to buy materials.`
            : payment.type === 'BALANCE'
              ? `${naira(payment.amountKobo)} balance paid. GADMO holds it for 12 hours, then pays your Pro. If something is wrong with the work, report it in the job chat before then.`
              : `${naira(payment.amountKobo)} paid. GADMO holds it until your Pro arrives.`}
        </p>
        {back}
      </>
    );
  }
  if (payment?.status === 'FAILED') {
    return (
      <>
        <h1 className="page-title">Payment didn’t go through</h1>
        <p className="alert alert-error" role="alert">
          No money was taken by GADMO. You can try again from the job chat.
        </p>
        {back}
      </>
    );
  }
  return (
    <>
      <h1 className="page-title">Checking your payment…</h1>
      <p className="meta" role="status">
        {gaveUp
          ? 'Still waiting for the payment provider to confirm. The job chat will update once it does.'
          : 'This takes a few seconds.'}
      </p>
      {gaveUp && back}
    </>
  );
}
