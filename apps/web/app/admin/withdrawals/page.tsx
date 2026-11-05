import type { Metadata } from 'next';
import { WithdrawalsList } from '@/components/admin/WithdrawalsList';

export const metadata: Metadata = { title: 'Withdrawals', robots: { index: false } };

export default function Page() {
  return (
    <main className="page page-wide">
      <WithdrawalsList />
    </main>
  );
}
