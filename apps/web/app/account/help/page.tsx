import type { Metadata } from 'next';
import { HelpPage } from '@/components/account/HelpPage';

export const metadata: Metadata = { title: 'Help' };

export default function Page() {
  return (
    <main className="page page-wide page-app">
      <HelpPage />
    </main>
  );
}
