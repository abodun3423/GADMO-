import Link from 'next/link';

export function SignedOut({ next, title }: { next: string; title: string }) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      <p className="lede">Sign in with your phone number to continue.</p>
      <Link className="button" href={`/signin?next=${encodeURIComponent(next)}`}>
        Sign in
      </Link>
    </>
  );
}
