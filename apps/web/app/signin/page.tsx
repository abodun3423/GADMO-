import type { Metadata } from 'next';
import { SignInForm } from '@/components/SignInForm';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="page">
      <h1 className="page-title">Sign in or create an account</h1>
      <p className="lede">We’ll text a 6-digit code to your phone. No password needed.</p>
      <SignInForm next={safeNext(next)} />
    </main>
  );
}
