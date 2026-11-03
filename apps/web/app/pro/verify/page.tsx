import type { Metadata } from 'next';
import { VerifyIdentity } from '@/components/VerifyIdentity';

export const metadata: Metadata = { title: 'Verify your identity' };

export default function VerifyPage() {
  return (
    <main className="page">
      <VerifyIdentity />
    </main>
  );
}
