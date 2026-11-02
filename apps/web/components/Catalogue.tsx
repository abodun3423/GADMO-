'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { serviceNote } from '@/lib/catalogue';
import type { Category, CategoryGroup } from '@/lib/types';

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

/** Home screen: search, the emergency strip, and every service group. */
export function Catalogue({ groups }: { groups: CategoryGroup[] | null }) {
  const [query, setQuery] = useState('');
  const all = useMemo(() => (groups ?? []).flatMap((g) => g.categories), [groups]);
  const emergency = all.filter((c) => c.emergencyEnabled);
  const q = query.trim().toLowerCase();
  const matches = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : [];

  return (
    <>
      <section className="adire">
        <div className="adire-inner">
          <h1>The right skills, within reach.</h1>
          <p>Verified skilled people across Ekiti. Book now or for later.</p>
          <label htmlFor="search" className="sr-only">
            Search services
          </label>
          <input
            id="search"
            className="search"
            type="search"
            placeholder="What do you need? e.g. plumber, baker"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </section>

      <div className="page page-wide">
        {groups === null ? (
          <p className="alert alert-error" role="alert">
            Services could not be loaded. Check your connection and refresh the page.
          </p>
        ) : q ? (
          <section aria-live="polite">
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
              <h2 id="emergency-title">⚠ Stuck? Get help now</h2>
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
            <div className="groups">
              {groups.map((g) => (
                <details key={g.id} className="group">
                  <summary>
                    {g.name}
                    <span className="count">{g.categories.length}</span>
                  </summary>
                  <ul className="services">
                    {g.categories.map((c) => (
                      <ServiceLink key={c.id} category={c} />
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
