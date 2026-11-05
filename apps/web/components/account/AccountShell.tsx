'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Role } from '@/lib/types';
import { useSession } from '@/lib/useSession';
import { Icon, type IconName } from './Icon';

interface Item {
  href: string;
  label: string;
  icon: IconName;
  /** Also current on these paths. */
  also?: string[];
}

const CUSTOMER: Item[] = [
  { href: '/account', label: 'Dashboard', icon: 'home' },
  { href: '/jobs', label: 'My jobs', icon: 'jobs' },
  { href: '/account/wallet', label: 'Wallet', icon: 'wallet' },
  { href: '/account/profile', label: 'Profile', icon: 'user' },
  { href: '/account/settings', label: 'Settings', icon: 'settings' },
  { href: '/account/privacy', label: 'Privacy & security', icon: 'shield' },
  { href: '/account/help', label: 'Help', icon: 'help' },
];

const PRO: Item[] = [
  { href: '/account', label: 'Dashboard', icon: 'home' },
  { href: '/pro', label: 'Jobs & requests', icon: 'jobs' },
  { href: '/account/wallet', label: 'Wallet', icon: 'wallet' },
  { href: '/pro/profile', label: 'Skills & area', icon: 'tools' },
  { href: '/pro/verify', label: 'Verification', icon: 'badge' },
  { href: '/account/profile', label: 'Profile', icon: 'user' },
  { href: '/account/settings', label: 'Settings', icon: 'settings' },
  { href: '/account/privacy', label: 'Privacy & security', icon: 'shield' },
  { href: '/account/help', label: 'Help', icon: 'help' },
];

export function menuFor(role: Role): Item[] {
  return role === 'PRO' ? PRO : CUSTOMER;
}

/**
 * The signed-in area for customers and Pros: a menu (side column on computers, a
 * scrolling row on phones) beside the page. Staff use the staff dashboard instead.
 */
export function AccountShell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const path = usePathname();
  if (!me || (me.role !== 'CUSTOMER' && me.role !== 'PRO')) return <>{children}</>;
  const items = menuFor(me.role);
  const current = (item: Item) => path === item.href || item.also?.some((p) => path.startsWith(p));
  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="Your account">
        <div className="shell-who">
          <span className="avatar" aria-hidden="true">
            {initials(me.name)}
          </span>
          <span>
            <strong>{me.name ?? 'Your account'}</strong>
            <span className="meta">{me.role === 'PRO' ? 'GADMO Pro' : 'Customer'}</span>
          </span>
        </div>
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="shell-link"
                aria-current={current(item) ? 'page' : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="shell-main">{children}</div>
    </div>
  );
}

export function initials(name: string | null): string {
  if (!name) return 'G';
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}
