import type { Metadata } from 'next';
import { TestCheckout } from '@/components/TestCheckout';

export const metadata: Metadata = { title: 'Test payment' };

export default async function TestCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { reference } = await searchParams;
  return (
    <main className="page">
      <TestCheckout reference={reference ?? ''} />
    </main>
  );
}
