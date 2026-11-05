import type { Metadata } from 'next';
import { WalletPage } from '@/components/account/WalletPage';

export const metadata: Metadata = { title: 'Wallet' };

export default function Page() {
  return (
    <main className="page page-wide page-app">
      <WalletPage />
    </main>
  );
}
