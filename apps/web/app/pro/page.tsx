import type { Metadata } from 'next';
import { AccountShell } from '@/components/account/AccountShell';
import { ProHome } from '@/components/ProHome';
import { getCatalogue } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Pro home' };

export default async function ProHomePage() {
  const groups = await getCatalogue();
  const names = Object.fromEntries(
    (groups ?? []).flatMap((g) => g.categories).map((c) => [c.id, c.name]),
  );
  return (
    <main className="page page-wide page-app">
      <AccountShell>
        <ProHome serviceNames={names} />
      </AccountShell>
    </main>
  );
}
