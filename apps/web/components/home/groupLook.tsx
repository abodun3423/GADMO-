import type { ReactNode } from 'react';

/**
 * Each service group wears one market-fabric colour and a simple line icon, so the home
 * page reads at a glance. Unknown groups fall back to indigo and a spark.
 */
export type Tone = 'indigo' | 'kola' | 'palm' | 'plum' | 'sky' | 'ochre';

const LOOK: Record<string, { tone: Tone; icon: string }> = {
  'home-repairs': { tone: 'indigo', icon: 'bolt' },
  auto: { tone: 'kola', icon: 'car' },
  'cleaning-household': { tone: 'palm', icon: 'sparkle' },
  'fashion-beauty': { tone: 'plum', icon: 'scissors' },
  events: { tone: 'ochre', icon: 'party' },
  'tech-digital': { tone: 'sky', icon: 'screen' },
  lessons: { tone: 'indigo', icon: 'cap' },
  professional: { tone: 'sky', icon: 'briefcase' },
  'health-fitness': { tone: 'palm', icon: 'heart' },
  'business-rentals': { tone: 'ochre', icon: 'store' },
  'moving-errands': { tone: 'kola', icon: 'truck' },
  farming: { tone: 'palm', icon: 'leaf' },
};

export function groupLook(slug: string): { tone: Tone; icon: string } {
  return LOOK[slug] ?? { tone: 'indigo', icon: 'sparkle' };
}

const TONES: Tone[] = ['indigo', 'kola', 'palm', 'plum', 'sky', 'ochre'];

/** A steady colour for a person (from their id), for initials avatars. */
export function toneFor(id: string): Tone {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[n % TONES.length]!;
}

/** Line icons on a 24px grid, drawn with the current text colour. */
export function GroupIcon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name] ?? ICONS.sparkle}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  car: (
    <>
      <path d="M4 16v-3l2-5h12l2 5v3z" />
      <circle cx="7.5" cy="17" r="1.8" />
      <circle cx="16.5" cy="17" r="1.8" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 16v4M17 18h4" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="7" r="3" />
      <circle cx="6" cy="17" r="3" />
      <path d="M8.5 8.5 20 18M8.5 15.5 20 6" />
    </>
  ),
  party: (
    <>
      <path d="M12 3a5 5 0 0 1 5 5c0 4-5 8-5 8s-5-4-5-8a5 5 0 0 1 5-5z" />
      <path d="M12 16c0 2-1 3-1 5" />
    </>
  ),
  screen: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  cap: (
    <>
      <path d="M2 9l10-5 10 5-10 5z" />
      <path d="M6 11v5c3 2.5 9 2.5 12 0v-5" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
    </>
  ),
  heart: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />,
  store: (
    <>
      <path d="M3 10l2-6h14l2 6" />
      <path d="M4 10h16v10H4zM10 20v-5h4v5" />
    </>
  ),
  truck: (
    <>
      <path d="M2 6h12v10H2zM14 10h4l4 4v2h-8" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17.5" cy="17.5" r="1.8" />
    </>
  ),
  drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  cake: (
    <>
      <path d="M4 20h16v-7H4zM4 16c2 1.5 4 1.5 5.3 0s4 1.5 5.4 0 4-1.5 5.3 0" />
      <path d="M12 13V9M12 6.5V6" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-8 6-14 15-14 0 9-6 14-15 14z" />
      <path d="M5 19l8-8" />
    </>
  ),
};
