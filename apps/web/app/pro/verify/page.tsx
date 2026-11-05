import type { Metadata } from 'next';
import { AccountShell } from '@/components/account/AccountShell';
import { VerifyIdentity } from '@/components/VerifyIdentity';

export const metadata: Metadata = { title: 'Verify your identity' };

export default function VerifyPage() {
  return (
    <main className="page page-wide page-app">
      <AccountShell>
        <VerifyIdentity />
      </AccountShell>
    </main>
  );
}
