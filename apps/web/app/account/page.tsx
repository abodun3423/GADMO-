import type { Metadata } from 'next';
import { Dashboard } from '@/components/account/Dashboard';
import { getCatalogue } from '@/lib/server-api';

export const metadata: Metadata = { title: 'My account' };

export default async function AccountPage() {
  const groups = await getCatalogue();
  const names = Object.fromEntries(
    (groups ?? []).flatMap((g) => g.categories).map((c) => [c.id, c.name]),
  );
  return (
    <main className="page page-wide page-app">
      <Dashboard serviceNames={names} />
    </main>
  );
}
