import { EMERGENCY_OFFER_SECONDS } from '@gadmo/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categories, jobOffers, jobs, proProfiles } from '../src/db/schema';
import { DispatchService } from '../src/dispatch/dispatch.service';
import { CLIENT_HEADER, createTestApp, login, type TestContext } from './helpers';

/**
 * Emergency dispatch: nearest online verified Pro first, 120 seconds each, never the same
 * Pro twice, and the request stays open when nobody accepts.
 */
let ctx: TestContext;
let dispatch: DispatchService;
let electricianId: string;
let plumberId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  dispatch = ctx.app.get(DispatchService);
  const rows = await ctx.db.select().from(categories);
  electricianId = rows.find((c) => c.slug === 'electrician')!.id;
  plumberId = rows.find((c) => c.slug === 'plumber')!.id;
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.redis.flushdb();
});

type Agent = Awaited<ReturnType<typeof login>>;

/** A random spot in Nigeria for each test, so Pros from other tests are never nearby. */
function somewhere() {
  return { latitude: 5 + Math.random() * 7, longitude: 4 + Math.random() * 8 };
}

const north = (base: { latitude: number; longitude: number }, km: number) => ({
  latitude: base.latitude + km / 111.2,
  longitude: base.longitude,
});

async function pro(
  at: { latitude: number; longitude: number },
  opts: { skills?: string[]; radius?: number; online?: boolean; verified?: boolean } = {},
): Promise<Agent> {
  const p = await login(ctx, { role: 'pro' });
  await p.agent
    .put('/v1/pro/profile')
    .set(CLIENT_HEADER)
    .send({
      categoryIds: opts.skills ?? [electricianId],
      bio: '',
      ...at,
      serviceRadiusKm: opts.radius ?? 10,
    })
    .expect(200);
  if (opts.verified !== false) {
    await ctx.db
      .update(proProfiles)
      .set({ verificationStatus: 'APPROVED' })
      .where(eq(proProfiles.userId, p.userId));
  }
  if (opts.online !== false && opts.verified !== false) {
    await p.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true }).expect(200);
  }
  return p;
}

async function emergency(customer: Agent, at: { latitude: number; longitude: number }) {
  const res = await customer.agent
    .post('/v1/jobs')
    .set(CLIENT_HEADER)
    .send({
      categoryId: electricianId,
      type: 'EMERGENCY',
      description: 'No power in the whole house since morning',
      ...at,
    })
    .expect(201);
  return res.body.job as { id: string; dispatch: string };
}

async function offersOf(p: Agent) {
  const res = await p.agent.get('/v1/pro/offers').expect(200);
  return res.body.offers as {
    id: string;
    secondsLeft: number;
    distanceKm: number;
    job: { id: string; description: string };
  }[];
}

/** Makes the job's live offer run out now (the database clock decides). */
async function runOut(jobId: string) {
  await ctx.db
    .update(jobOffers)
    .set({ expiresAt: sql`now() - interval '1 second'` })
    .where(and(eq(jobOffers.jobId, jobId), eq(jobOffers.status, 'PENDING')));
  await dispatch.advance(jobId);
}

describe('emergency dispatch', () => {
  it('offers the request to the nearest Pro first, for 120 seconds', async () => {
    const base = somewhere();
    const far = await pro(north(base, 6));
    const near = await pro(north(base, 1));
    const customer = await login(ctx);
    const job = await emergency(customer, base);
    expect(job.dispatch).toBe('OFFERED');

    expect(await offersOf(far)).toEqual([]);
    const [offer] = await offersOf(near);
    expect(offer!.job.id).toBe(job.id);
    expect(offer!.job.description).toContain('No power');
    expect(offer!.secondsLeft).toBeGreaterThan(EMERGENCY_OFFER_SECONDS - 10);
    expect(offer!.secondsLeft).toBeLessThanOrEqual(EMERGENCY_OFFER_SECONDS);
    expect(offer!.distanceKm).toBeGreaterThanOrEqual(1);
    expect(offer!.distanceKm).toBeLessThanOrEqual(1.5);
    // No customer identity or exact location in an offer.
    expect(JSON.stringify(offer)).not.toContain(customer.userId);
    expect(JSON.stringify(offer)).not.toContain(String(base.latitude));
  });

  it('accepting assigns the Pro; the customer sees their name', async () => {
    const base = somewhere();
    const tunde = await pro(north(base, 1));
    await tunde.agent.patch('/v1/me').set(CLIENT_HEADER).send({ name: 'Tunde' }).expect(200);
    const customer = await login(ctx);
    const job = await emergency(customer, base);
    const [offer] = await offersOf(tunde);
    const res = await tunde.agent
      .post(`/v1/pro/offers/${offer!.id}/accept`)
      .set(CLIENT_HEADER)
      .expect(200);
    expect(res.body.job).toMatchObject({ id: job.id, status: 'ACCEPTED', proId: tunde.userId });
    expect(await offersOf(tunde)).toEqual([]);

    const seen = await customer.agent.get(`/v1/jobs/${job.id}`).expect(200);
    expect(seen.body.job).toMatchObject({ status: 'ACCEPTED', proName: 'Tunde', dispatch: null });
    // The Pro now sees the job in their own list.
    const mine = await tunde.agent.get('/v1/jobs').expect(200);
    expect(mine.body.jobs.map((j: { id: string }) => j.id)).toContain(job.id);
  });

  it('declining or running out moves it to the next nearest Pro, never back', async () => {
    const base = somewhere();
    const first = await pro(north(base, 1));
    const second = await pro(north(base, 2));
    const third = await pro(north(base, 3));
    const customer = await login(ctx);
    const job = await emergency(customer, base);

    const [o1] = await offersOf(first);
    await first.agent.post(`/v1/pro/offers/${o1!.id}/decline`).set(CLIENT_HEADER).expect(200);
    const [o2] = await offersOf(second);
    expect(o2!.job.id).toBe(job.id);

    await runOut(job.id);
    expect(await offersOf(second)).toEqual([]);
    const [o3] = await offersOf(third);
    expect(o3!.job.id).toBe(job.id);
    // The run-out offer can no longer be taken.
    await second.agent.post(`/v1/pro/offers/${o2!.id}/accept`).set(CLIENT_HEADER).expect(409);
    expect(await offersOf(first)).toEqual([]);
  });

  it('stays open when nobody accepts, and goes to a Pro who comes online later', async () => {
    const base = somewhere();
    const only = await pro(north(base, 1));
    const customer = await login(ctx);
    const job = await emergency(customer, base);
    const [offer] = await offersOf(only);
    await only.agent.post(`/v1/pro/offers/${offer!.id}/decline`).set(CLIENT_HEADER).expect(200);

    const waiting = await customer.agent.get(`/v1/jobs/${job.id}`).expect(200);
    expect(waiting.body.job).toMatchObject({ status: 'REQUESTED', dispatch: 'NO_PRO_YET' });

    const late = await pro(north(base, 4), { online: false });
    expect(await offersOf(late)).toEqual([]);
    await late.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true }).expect(200);
    const [lateOffer] = await offersOf(late);
    expect(lateOffer!.job.id).toBe(job.id);
    const again = await customer.agent.get(`/v1/jobs/${job.id}`).expect(200);
    expect(again.body.job.dispatch).toBe('OFFERED');
  });

  it('skips Pros who are offline, unverified, too far, or offer another service', async () => {
    const base = somewhere();
    const offline = await pro(north(base, 1), { online: false });
    const unverified = await pro(north(base, 1), { verified: false });
    const outOfRange = await pro(north(base, 8), { radius: 5 });
    const plumber = await pro(north(base, 1), { skills: [plumberId] });
    const customer = await login(ctx);
    const job = await emergency(customer, base);
    expect(job.dispatch).toBe('NO_PRO_YET');
    for (const p of [offline, unverified, outOfRange, plumber]) {
      if (p === unverified) await p.agent.get('/v1/pro/offers').expect(200);
      expect(await offersOf(p)).toEqual([]);
    }
  });

  it('a Pro holds one emergency offer at a time', async () => {
    const base = somewhere();
    const busy = await pro(north(base, 1));
    const backup = await pro(north(base, 5));
    const customer = await login(ctx);
    const a = await emergency(customer, base);
    const b = await emergency(customer, base);
    const busyOffers = await offersOf(busy);
    expect(busyOffers.map((o) => o.job.id)).toEqual([a.id]);
    const [backupOffer] = await offersOf(backup);
    expect(backupOffer!.job.id).toBe(b.id);
  });

  it('only one accept wins, even when sent twice at once', async () => {
    const base = somewhere();
    const p = await pro(north(base, 1));
    const customer = await login(ctx);
    await emergency(customer, base);
    const [offer] = await offersOf(p);
    const tries = await Promise.all([
      p.agent.post(`/v1/pro/offers/${offer!.id}/accept`).set(CLIENT_HEADER),
      p.agent.post(`/v1/pro/offers/${offer!.id}/accept`).set(CLIENT_HEADER),
    ]);
    expect(tries.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('the customer can cancel until a Pro accepts; the offer is withdrawn', async () => {
    const base = somewhere();
    const p = await pro(north(base, 1));
    const customer = await login(ctx);
    const job = await emergency(customer, base);
    const [offer] = await offersOf(p);
    const res = await customer.agent
      .post(`/v1/jobs/${job.id}/cancel`)
      .set(CLIENT_HEADER)
      .expect(200);
    expect(res.body.job.status).toBe('CANCELLED');
    expect(await offersOf(p)).toEqual([]);
    await p.agent.post(`/v1/pro/offers/${offer!.id}/accept`).set(CLIENT_HEADER).expect(409);
    await dispatch.tick();
    expect(await offersOf(p)).toEqual([]);

    // Once a Pro has accepted, cancelling here is refused.
    const job2 = await emergency(customer, base);
    const [offer2] = await offersOf(p);
    await p.agent.post(`/v1/pro/offers/${offer2!.id}/accept`).set(CLIENT_HEADER).expect(200);
    await customer.agent.post(`/v1/jobs/${job2.id}/cancel`).set(CLIENT_HEADER).expect(409);
    const [row] = await ctx.db.select().from(jobs).where(eq(jobs.id, job2.id));
    expect(row!.status).toBe('ACCEPTED');
  });
});
