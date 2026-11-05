import type { Metadata } from 'next';
import { PaymentReturn } from '@/components/PaymentReturn';

export const metadata: Metadata = { title: 'Payment' };

/** Where the payment page sends the customer back to (Paystack adds ?reference=…). */
export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}) {
  const { reference, trxref } = await searchParams;
  return (
    <main className="page">
      <PaymentReturn reference={reference ?? trxref ?? ''} />
    </main>
  );
}
