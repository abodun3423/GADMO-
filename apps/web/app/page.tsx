import { Catalogue } from '@/components/Catalogue';
import { BecomePro, Footer, HowItWorks, TopPros } from '@/components/home/HomeSections';
import { getCatalogue, getTopPros } from '@/lib/server-api';

export default async function HomePage() {
  const [groups, pros] = await Promise.all([getCatalogue(), getTopPros()]);

  return (
    <>
      <main>
        <Catalogue groups={groups} />
        <TopPros pros={pros} />
        <HowItWorks />
        <BecomePro />
      </main>
      <Footer />
    </>
  );
}
