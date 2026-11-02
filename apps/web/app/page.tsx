import { Catalogue } from '@/components/Catalogue';
import { getCatalogue } from '@/lib/server-api';

export default async function HomePage() {
  const groups = await getCatalogue();

  return (
    <main>
      <Catalogue groups={groups} />
    </main>
  );
}
