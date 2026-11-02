import type { Metadata } from 'next';
import Link from 'next/link';
import { RequestForm } from '@/components/RequestForm';
import { serviceNote } from '@/lib/catalogue';
import { getCatalogue } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Request a service' };

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; urgent?: string }>;
}) {
  const { service, urgent } = await searchParams;
  const groups = await getCatalogue();
  const category = groups?.flatMap((g) => g.categories).find((c) => c.slug === service);

  if (!category) {
    return (
      <main className="page">
        <h1 className="page-title">Choose a service first</h1>
        <p className="lede">That service could not be found.</p>
        <Link className="button" href="/">
          See all services
        </Link>
      </main>
    );
  }

  return (
    <main className="page">
      <h1 className="page-title">{category.name}</h1>
      <p className="lede">{serviceNote(category)}.</p>
      <RequestForm category={category} startUrgent={urgent === '1' && category.emergencyEnabled} />
    </main>
  );
}
