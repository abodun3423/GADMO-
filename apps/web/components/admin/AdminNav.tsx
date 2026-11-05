'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/checks', label: 'Identity checks' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/jobs', label: 'Jobs' },
];

/** The staff dashboard's sections. */
export function AdminNav() {
  const path = usePathname();
  const current = (href: string) =>
    href === '/admin'
      ? path === '/admin'
      : path.startsWith(href) ||
        (href === '/admin/checks' && path.startsWith('/admin/verifications'));
  return (
    <nav className="tabs admin-nav" aria-label="Staff sections">
      {SECTIONS.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          className="tab"
          aria-current={current(s.href) ? 'page' : undefined}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
