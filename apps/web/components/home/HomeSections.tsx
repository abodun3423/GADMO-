import Link from 'next/link';
import { PRO_IMAGE } from '@/lib/images';
import type { TopPro } from '@/lib/types';
import { AdirePattern } from './AdirePattern';
import { PhotoCard } from './Photos';
import { toneFor } from './groupLook';

function initials(name: string): string {
  return name
    .replace(/\./g, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** A few of the best-rated verified Pros. Hidden until there are some. */
export function TopPros({ pros, embedded = false }: { pros: TopPro[]; embedded?: boolean }) {
  if (pros.length === 0) return null;
  return (
    <section
      className={embedded ? 'top-pros-embedded' : 'page page-wide home-section'}
      aria-labelledby="top-pros"
    >
      <h2 id="top-pros" className="section-title">
        Top-rated Pros
      </h2>
      <ul className="pro-strip">
        {pros.map((p) => {
          const skill = p.skills[0]!;
          return (
            <li key={p.id}>
              <Link className="pro-tile" href={`/request?service=${skill.slug}`}>
                <span className={`pro-face tone-${toneFor(p.id)}`} aria-hidden="true">
                  {initials(p.name)}
                </span>
                <span className="pro-tile-name">{p.name}</span>
                <span className="pro-tile-skill">
                  {skill.name}
                  {p.skills.length > 1 ? ` +${p.skills.length - 1}` : ''}
                </span>
                <span className="verified">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m5 12 4.5 4.5L19 7" />
                  </svg>
                  {p.ratingCount > 0
                    ? `Verified · ${p.ratingAvg.toFixed(1)}★ (${p.ratingCount})`
                    : 'Verified · new'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const STEPS = [
  {
    title: 'Say what you need',
    body: 'Pick a service and describe the job. In an emergency, the nearest online Pro is alerted at once.',
  },
  {
    title: 'Agree the price in chat',
    body: 'Talk to a verified Pro in GADMO chat. For repairs, they inspect first, then send a clear quote.',
  },
  {
    title: 'Pay safely in GADMO',
    body: 'Pay in the app and GADMO holds the final payment for 12 hours, so you can report a problem before the Pro is paid.',
  },
];

export function HowItWorks() {
  return (
    <section className="page page-wide home-section" aria-labelledby="how">
      <h2 id="how" className="section-title">
        How GADMO works
      </h2>
      <ol className="how">
        {STEPS.map((s) => (
          <li key={s.title}>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function BecomePro() {
  return (
    <section className="join" aria-labelledby="join-title">
      <AdirePattern className="join-pattern" />
      <div className="join-inner">
        <h2 id="join-title">Have a skill? Earn with GADMO.</h2>
        <p>
          Get jobs from people near you, agree your price in chat and get paid straight to your bank
          account. Free to join. GADMO takes 10% only when you’re paid in the app.
        </p>
        <Link className="button join-button" href="/signin">
          Join as a Pro
        </Link>
      </div>
      <PhotoCard photo={PRO_IMAGE} className="join-photo" />
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <p className="footer-brand">GADMO</p>
        <p>The right skills. Within reach. Starting in Ado-Ekiti, Ekiti State.</p>
        <p className="footer-small">© {new Date().getFullYear()} GADMO Technologies</p>
      </div>
    </footer>
  );
}
