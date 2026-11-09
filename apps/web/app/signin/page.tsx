import type { Metadata } from 'next';
import { AdirePattern } from '@/components/home/AdirePattern';
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
    <main className="auth">
      <section className="auth-brand" aria-label="About GADMO">
        <AdirePattern className="hero-pattern" />
        <div className="auth-brand-inner">
          <p className="auth-tag">The right skills. Within reach.</p>
          <ul className="trust">
            <li>NIN-verified Pros</li>
            <li>Payments protected by GADMO</li>
            <li>Your number stays private</li>
          </ul>
        </div>
      </section>
      <div className="page auth-card">
        <h1 className="page-title">Sign in or create an account</h1>
        <p className="lede">We’ll text a 6-digit code to your phone. No password needed.</p>
        <SignInForm next={safeNext(next)} />
      </div>
    </main>
  );
}
