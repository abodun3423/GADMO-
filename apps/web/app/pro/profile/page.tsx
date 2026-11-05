import type { Metadata } from 'next';
import { AccountShell } from '@/components/account/AccountShell';
import { ProProfileForm } from '@/components/ProProfileForm';
import { getCatalogue } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Your Pro profile' };

export default async function ProProfilePage() {
  const groups = await getCatalogue();
  return (
    <main className="page page-wide page-app">
      <AccountShell>
        <ProProfileForm groups={groups ?? []} />
      </AccountShell>
    </main>
  );
}
