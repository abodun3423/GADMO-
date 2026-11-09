import type { Metadata } from 'next';
import { Dashboard, type QuickService } from '@/components/account/Dashboard';
import type { Tone } from '@/components/home/groupLook';
import { getCatalogue, getTopPros } from '@/lib/server-api';

export const metadata: Metadata = { title: 'My account' };

/** The services customers ask for most, shown as quick tiles on their dashboard. */
const QUICK: [slug: string, icon: string, tone: Tone][] = [
  ['electrician', 'bolt', 'indigo'],
  ['plumber', 'drop', 'sky'],
  ['auto-mechanic', 'car', 'kola'],
  ['hairstylist', 'scissors', 'plum'],
  ['house-cleaner', 'sparkle', 'palm'],
  ['baker', 'cake', 'ochre'],
];

export default async function AccountPage() {
  const [groups, topPros] = await Promise.all([getCatalogue(), getTopPros()]);
  const all = (groups ?? []).flatMap((g) => g.categories);
  const names = Object.fromEntries(all.map((c) => [c.id, c.name]));
  const quick: QuickService[] = QUICK.flatMap(([slug, icon, tone]) => {
    const cat = all.find((c) => c.slug === slug);
    return cat ? [{ slug, name: cat.name, icon, tone }] : [];
  });
  return (
    <main className="page page-wide page-app">
      <Dashboard serviceNames={names} quick={quick} topPros={topPros} />
    </main>
  );
}
