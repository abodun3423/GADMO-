import type { Metadata } from 'next';
import { Account } from '@/components/Account';

export const metadata: Metadata = { title: 'My account' };

export default function AccountPage() {
  return (
    <main className="page">
      <Account />
    </main>
  );
}
