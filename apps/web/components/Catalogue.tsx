'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { serviceNote } from '@/lib/catalogue';
import { HERO_IMAGE } from '@/lib/images';
import type { Category, CategoryGroup } from '@/lib/types';
import { AdirePattern } from './home/AdirePattern';
import { GroupIcon, groupLook } from './home/groupLook';

function ServiceLink({ category }: { category: Category }) {
  return (
    <li>
      <Link className="service" href={`/request?service=${category.slug}`}>
        <span className="service-name">{category.name}</span>
        <span className="service-note">{serviceNote(category)}</span>
      </Link>
    </li>
  );
}

/** Home screen: the Adire hero with search, emergency help, and the service groups as tiles. */
export function Catalogue({ groups }: { groups: CategoryGroup[] | null }) {
  const [query, setQuery] = useState('');
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const all = useMemo(() => (groups ?? []).flatMap((g) => g.categories), [groups]);
  const emergency = all.filter((c) => c.emergencyEnabled);
  const q = query.trim().toLowerCase();
  const matches = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : [];
  const open = groups?.find((g) => g.slug === openSlug) ?? null;

  return (
    <>
      <section className={`hero${HERO_IMAGE ? ' hero-photo' : ''}`}>
        {HERO_IMAGE ? (
          <img className="hero-img" src={HERO_IMAGE} alt="" fetchPriority="high" />
        ) : (
          <AdirePattern className="hero-pattern" />
        )}
        <div className="hero-inner">
          <h1>The right skills. Within reach.</h1>
          <p className="hero-lede">
            Verified electricians, mechanics, tutors and more across Ado-Ekiti. Book now or for
            later.
          </p>
          <label htmlFor="search" className="sr-only">
            Search services
          </label>
          <div className="search-wrap">
            <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id="search"
              className="search"
              type="search"
              placeholder="What do you need done? e.g. plumber"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ul className="trust">
            <li>NIN-verified Pros</li>
            <li>Payments protected by GADMO</li>
            <li>Your number stays private</li>
          </ul>
        </div>
      </section>

      <div className="page page-wide home">
        {groups === null ? (
          <p className="alert alert-error" role="alert">
            Services could not be loaded. Check your connection and refresh the page.
          </p>
        ) : q ? (
          <section aria-live="polite" className="search-results">
            <h2 className="section-title">
              {matches.length === 0
                ? `No service matches “${query.trim()}”`
                : `${matches.length} ${matches.length === 1 ? 'service' : 'services'} found`}
            </h2>
            {matches.length === 0 ? (
              <p className="empty">Try a shorter word, like “fix”, “clean” or “car”.</p>
            ) : (
              <ul className="services">
                {matches.map((c) => (
                  <ServiceLink key={c.id} category={c} />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
            <section className="emergency" aria-labelledby="emergency-title">
              <h2 id="emergency-title">
                <svg className="emergency-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3 2 20h20z" />
                  <path className="emergency-mark" d="M12 9v5M12 16.5v.5" />
                </svg>
                Stuck? Get help now
              </h2>
              <p>Power, water, lock or roadside trouble. We alert the nearest available Pros.</p>
              <ul className="chips">
                {emergency.map((c) => (
                  <li key={c.id}>
                    <Link className="chip" href={`/request?service=${c.slug}&urgent=1`}>
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <h2 className="section-title">All services</h2>
            <ul className="tiles">
              {groups.map((g) => {
                const look = groupLook(g.slug);
                const isOpen = g.slug === openSlug;
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      className={`tile tone-${look.tone}${isOpen ? ' tile-open' : ''}`}
                      aria-expanded={isOpen}
                      aria-controls="group-services"
                      onClick={() => setOpenSlug(isOpen ? null : g.slug)}
                    >
                      <GroupIcon name={look.icon} className="tile-icon" />
                      <span className="tile-name">{g.name}</span>
                      <span className="tile-count">{g.categories.length} services</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div id="group-services" aria-live="polite">
              {open && (
                <section className={`group-panel tone-${groupLook(open.slug).tone}`}>
                  <h3>{open.name}</h3>
                  <ul className="services">
                    {open.categories.map((c) => (
                      <ServiceLink key={c.id} category={c} />
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
