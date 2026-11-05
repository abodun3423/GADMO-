import { describe, expect, it } from 'vitest';
import { CATALOGUE, RELATED, relatedSlugs } from './categories';

const all = CATALOGUE.flatMap((g) => g.categories);
const group = (slug: string) => CATALOGUE.find((g) => g.slug === slug)!.categories;

describe('service catalogue', () => {
  it('has unique slugs across groups and categories', () => {
    const slugs = [...CATALOGUE.map((g) => g.slug), ...all.map((c) => c.slug)];
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses URL-safe slugs', () => {
    for (const c of all) expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('charges no inspection fee for tech, lessons, events, beauty and businesses', () => {
    for (const slug of [
      'tech-digital',
      'lessons',
      'events',
      'fashion-beauty',
      'business-rentals',
    ]) {
      for (const c of group(slug)) expect(c.inspection, c.slug).toBe('N');
    }
  });

  it('requires an inspection for every emergency category except towing', () => {
    for (const c of all.filter((x) => x.emergency && x.slug !== 'towing')) {
      expect(c.inspection, c.slug).toBe('R');
    }
  });

  it('flags regulated professions for a licence check', () => {
    for (const slug of ['lawyer', 'home-nurse', 'veterinary-doctor', 'physiotherapist']) {
      expect(all.find((c) => c.slug === slug)?.licence, slug).toBe(true);
    }
  });

  it('relates only real skills, in sets of two or more', () => {
    const slugs = new Set(all.map((c) => c.slug));
    for (const set of RELATED) {
      expect(set.length, set.join()).toBeGreaterThan(1);
      for (const s of set) expect(slugs.has(s), s).toBe(true);
    }
  });

  it('finds related skills both ways, never the skill itself', () => {
    expect(relatedSlugs(['auto-mechanic']).sort()).toEqual(
      ['auto-electrician', 'car-ac-repair', 'motorcycle-mechanic', 'towing'].sort(),
    );
    expect(relatedSlugs(['towing'])).toEqual(['auto-mechanic']);
    expect(relatedSlugs(['car-wash'])).toEqual([]);
    expect(relatedSlugs(['plumber', 'borehole-pump'])).not.toContain('plumber');
  });
});
