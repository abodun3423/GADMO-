import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CATALOGUE } from '../src/db/categories';
import { seed } from '../src/db/seed';
import { CLIENT_HEADER, createTestApp, login, type TestContext } from './helpers';
import { TEST_DATABASE_URL } from './test-env';

interface Category {
  id: string;
  slug: string;
  emergencyEnabled: boolean;
  inspectionPolicy: 'REQUIRED' | 'OPTIONAL' | 'NONE';
  licenceRequired: boolean;
}
interface Group {
  id: string;
  slug: string;
  categories: Category[];
}

let ctx: TestContext;
let groups: Group[];

beforeAll(async () => {
  ctx = await createTestApp();
  const res = await request(ctx.server).get('/v1/categories').expect(200);
  groups = (res.body as { groups: Group[] }).groups;
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.redis.flushdb();
});

const find = (slug: string) => groups.flatMap((g) => g.categories).find((c) => c.slug === slug)!;

describe('service catalogue API', () => {
  it('returns every group in catalogue order with all its categories', () => {
    expect(groups.map((g) => g.slug)).toEqual(CATALOGUE.map((g) => g.slug));
    const total = groups.reduce((n, g) => n + g.categories.length, 0);
    expect(total).toBe(CATALOGUE.reduce((n, g) => n + g.categories.length, 0));
    expect(total).toBeGreaterThanOrEqual(100);
  });

  it('marks inspection policy, emergency and licence flags', () => {
    expect(find('electrician')).toMatchObject({
      inspectionPolicy: 'REQUIRED',
      emergencyEnabled: true,
    });
    expect(find('web-developer')).toMatchObject({
      inspectionPolicy: 'NONE',
      emergencyEnabled: false,
    });
    expect(find('event-hall').inspectionPolicy).toBe('NONE');
    expect(find('baker').inspectionPolicy).toBe('NONE');
    expect(find('house-cleaner').inspectionPolicy).toBe('OPTIONAL');
    expect(find('lawyer').licenceRequired).toBe(true);
  });

  it('never exposes a fixed inspection fee (fees are agreed per job)', () => {
    expect(JSON.stringify(groups)).not.toMatch(/inspectionFee/i);
  });

  it('seeding twice is safe and keeps the same ids', async () => {
    const before = find('plumber').id;
    await seed(TEST_DATABASE_URL);
    const res = await request(ctx.server).get('/v1/categories').expect(200);
    const again = (res.body as { groups: Group[] }).groups
      .flatMap((g) => g.categories)
      .find((c) => c.slug === 'plumber')!;
    expect(again.id).toBe(before);
  });

  it('a job cannot be booked against a whole group, only a category', async () => {
    const alice = await login(ctx);
    const homeRepairs = groups.find((g) => g.slug === 'home-repairs')!;
    await alice.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send({
        categoryId: homeRepairs.id,
        type: 'SCHEDULED',
        description: 'Need someone to look at the kitchen sink',
        latitude: 7.6233,
        longitude: 5.2209,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(422);
  });

  it('a non-emergency tech service can be scheduled', async () => {
    const alice = await login(ctx);
    await alice.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send({
        categoryId: find('web-developer').id,
        type: 'SCHEDULED',
        description: 'Website for my bakery with an order form',
        latitude: 7.6233,
        longitude: 5.2209,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);
  });
});
