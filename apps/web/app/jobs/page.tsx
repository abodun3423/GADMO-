import type { Metadata } from 'next';
import { AccountShell } from '@/components/account/AccountShell';
import { MyJobs } from '@/components/MyJobs';
import { getCatalogue } from '@/lib/server-api';

export const metadata: Metadata = { title: 'My jobs' };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const groups = await getCatalogue();
  const names = Object.fromEntries(
    (groups ?? []).flatMap((g) => g.categories).map((c) => [c.id, c.name]),
  );
  return (
    <main className="page page-wide page-app">
      <AccountShell>
        <MyJobs serviceNames={names} justSent={sent === '1'} />
      </AccountShell>
    </main>
  );
}
