import { EMERGENCY_OFFER_SECONDS } from '@gadmo/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categories, jobOffers, jobs, proProfiles } from '../src/db/schema';
import { DispatchService, EMERGENCY_REOFFER_MINUTES } from '../src/dispatch/dispatch.service';
import { CLIENT_HEADER, createTestApp, login, type TestContext } from './helpers';

/**
 * Emergency dispatch: nearest online verified Pro first, 120 seconds each, never the same
 * Pro twice, and the request stays open when nobody accepts.
 */
let ctx: TestContext;
let dispatch: DispatchService;
let electricianId: string;
let plumberId: string;
let generatorRepairId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  dispatch = ctx.app.get(DispatchService);
  const rows = await ctx.db.select().from(categories);
  electricianId = rows.find((c) => c.slug === 'electrician')!.id;
  plumberId = rows.find((c) => c.slug === 'plumber')!.id;
  generatorRepairId = rows.find((c) => c.slug === 'generator-repair')!.id;
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.redis.flushdb();
});

type Agent = Awaited<ReturnType<typeof login>>;

/** A random spot in Nigeria for each test, so Pros from other tests are never nearby. */
/**
 * A random spot in a wide area no other test file uses, so Pros made by other tests (or
 * earlier runs against the same database) are almost never within range of this test's job.
 */
function somewhere() {
  return { latitude: -20 - Math.random() * 40, longitude: -75 - Math.random() * 95 };
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

  it('declining or running out moves it to the next nearest Pro, not back for now', async () => {
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

  it('a Pro who missed it is asked again after 10 minutes if nobody took it; never after a decline', async () => {
    const base = somewhere();
    const missed = await pro(north(base, 1));
    const declined = await pro(north(base, 2));
    const customer = await login(ctx);
    const job = await emergency(customer, base);

    await runOut(job.id); // `missed` didn't answer
    const [o2] = await offersOf(declined);
    await declined.agent.post(`/v1/pro/offers/${o2!.id}/decline`).set(CLIENT_HEADER).expect(200);
    await dispatch.advance(job.id);
    expect(await offersOf(missed)).toEqual([]); // too soon

    // Ten minutes after the missed offer ran out, it comes back to that Pro only.
    await ctx.db
      .update(jobOffers)
      .set({
        expiresAt: sql`now() - make_interval(mins => ${EMERGENCY_REOFFER_MINUTES}) - interval '1 second'`,
      })
      .where(and(eq(jobOffers.jobId, job.id), eq(jobOffers.proId, missed.userId)));
    await dispatch.tick();
    const [again] = await offersOf(missed);
    expect(again!.job.id).toBe(job.id);
    expect(await offersOf(declined)).toEqual([]);
    await missed.agent.post(`/v1/pro/offers/${again!.id}/accept`).set(CLIENT_HEADER).expect(200);
    const done = await customer.agent.get(`/v1/jobs/${job.id}`).expect(200);
    expect(done.body.job).toMatchObject({ status: 'ACCEPTED', proId: missed.userId });
  });

  it('a Pro never asked comes before one who missed it', async () => {
    const base = somewhere();
    const missed = await pro(north(base, 1));
    const customer = await login(ctx);
    const job = await emergency(customer, base);
    await runOut(job.id);
    await ctx.db
      .update(jobOffers)
      .set({ expiresAt: sql`now() - interval '1 hour'` })
      .where(eq(jobOffers.jobId, job.id));
    const newcomer = await pro(north(base, 5), { online: false });
    await newcomer.agent
      .post('/v1/pro/online')
      .set(CLIENT_HEADER)
      .send({ online: true })
      .expect(200);
    expect((await offersOf(newcomer)).map((o) => o.job.id)).toEqual([job.id]);
    expect(await offersOf(missed)).toEqual([]);
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

  it('goes to the nearest Pro with the exact or a related skill', async () => {
    const base = somewhere();
    const electrician = await pro(north(base, 3));
    const generatorRepair = await pro(north(base, 1), { skills: [generatorRepairId] });
    await pro(north(base, 0.5), { skills: [plumberId] }); // not related
    const customer = await login(ctx);
    const job = await emergency(customer, base);
    expect((await offersOf(generatorRepair)).map((o) => o.job.id)).toEqual([job.id]);
    expect(await offersOf(electrician)).toEqual([]);
    await runOut(job.id);
    expect((await offersOf(electrician)).map((o) => o.job.id)).toEqual([job.id]);
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

describe('scheduled jobs: the customer chooses a Pro', () => {
  async function scheduled(
    customer: Agent,
    at: { latitude: number; longitude: number },
    hours = 48,
  ) {
    const res = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send({
        categoryId: electricianId,
        type: 'SCHEDULED',
        scheduledAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
        description: 'Fit three ceiling fans in the living room',
        ...at,
      })
      .expect(201);
    return res.body.job as { id: string; dispatch: string };
  }

  it('lists verified Pros in range, best rated first; offline Pros count too', async () => {
    const base = somewhere();
    const near = await pro(north(base, 1), { online: false });
    const farButGood = await pro(north(base, 6));
    await ctx.db
      .update(proProfiles)
      .set({ ratingAvg: 4.8, ratingCount: 12 })
      .where(eq(proProfiles.userId, farButGood.userId));
    const unverified = await pro(north(base, 1), { verified: false });
    const outOfRange = await pro(north(base, 8), { radius: 5 });
    const plumber = await pro(north(base, 1), { skills: [plumberId] });
    const customer = await login(ctx);
    const job = await scheduled(customer, base);
    expect(job.dispatch).toBe('CHOOSE_PRO');

    const res = await customer.agent.get(`/v1/jobs/${job.id}/pros`).expect(200);
    const ids = res.body.pros.map((p: { id: string }) => p.id);
    expect(ids).toEqual([farButGood.userId, near.userId]);
    for (const hidden of [unverified, outOfRange, plumber])
      expect(ids).not.toContain(hidden.userId);
    expect(res.body.pros[0]).toMatchObject({ ratingAvg: 4.8, skills: ['Electrician'] });
    expect(res.body.pros[0].phone).toBeUndefined();
    expect(res.body.pros[0].latitude).toBeUndefined();
  });

  it('Pros with a related skill are listed after exact ones, and see the request', async () => {
    const base = somewhere();
    const related = await pro(north(base, 1), { skills: [generatorRepairId] });
    await ctx.db
      .update(proProfiles)
      .set({ ratingAvg: 5, ratingCount: 3 })
      .where(eq(proProfiles.userId, related.userId));
    const exact = await pro(north(base, 4));
    const unrelated = await pro(north(base, 1), { skills: [plumberId] });
    const customer = await login(ctx);
    const job = await scheduled(customer, base);

    const res = await customer.agent.get(`/v1/jobs/${job.id}/pros`).expect(200);
    expect(
      res.body.pros.map((p: { id: string; exactSkill: boolean }) => [p.id, p.exactSkill]),
    ).toEqual([
      [exact.userId, true],
      [related.userId, false],
    ]);
    expect(res.body.pros[1].skills).toEqual(['Generator repair']);

    const nearby = async (p: Agent) =>
      (await p.agent.get('/v1/pro/jobs/nearby').expect(200)).body.jobs.map(
        (j: { id: string }) => j.id,
      );
    expect(await nearby(related)).toContain(job.id);
    expect(await nearby(unrelated)).not.toContain(job.id);

    await customer.agent
      .post(`/v1/jobs/${job.id}/requests`)
      .set(CLIENT_HEADER)
      .send({ proId: unrelated.userId })
      .expect(422);
    await customer.agent
      .post(`/v1/jobs/${job.id}/requests`)
      .set(CLIENT_HEADER)
      .send({ proId: related.userId })
      .expect(201);
  });

  it('the chosen Pro accepts, and chat opens; the customer saw who they asked', async () => {
    const base = somewhere();
    const tunde = await pro(north(base, 2), { online: false });
    await tunde.agent.patch('/v1/me').set(CLIENT_HEADER).send({ name: 'Tunde' }).expect(200);
    const customer = await login(ctx);
    const job = await scheduled(customer, base);
    const sent = await customer.agent
      .post(`/v1/jobs/${job.id}/requests`)
      .set(CLIENT_HEADER)
      .send({ proId: tunde.userId })
      .expect(201);
    expect(sent.body.request).toMatchObject({ proId: tunde.userId, proName: 'Tunde' });
    const left = new Date(sent.body.request.expiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(23 * 3_600_000);
    expect(left).toBeLessThanOrEqual(24 * 3_600_000 + 60_000);

    const mine = await customer.agent.get(`/v1/jobs/${job.id}`).expect(200);
    expect(mine.body.job).toMatchObject({ dispatch: 'OFFERED', requestedPro: { name: 'Tunde' } });
    // Only one Pro at a time.
    const other = await pro(north(base, 3));
    await customer.agent
      .post(`/v1/jobs/${job.id}/requests`)
      .set(CLIENT_HEADER)
      .send({ proId: other.userId })
      .expect(409);

    const [offer] = await offersOf(tunde);
    expect(offer!.job).toMatchObject({ id: job.id, type: 'SCHEDULED' });
    expect(offer!.secondsLeft).toBeGreaterThan(23 * 3600);
    await tunde.agent.post(`/v1/pro/offers/${offer!.id}/accept`).set(CLIENT_HEADER).expect(200);
    const convo = await customer.agent.get(`/v1/jobs/${job.id}/conversation`).expect(200);
    expect(convo.body.conversation).toMatchObject({ open: true, other: { name: 'Tunde' } });
  });

  it('a decline or a run-out request lets the customer choose someone else, never the same Pro', async () => {
    const base = somewhere();
    const first = await pro(north(base, 1));
    const second = await pro(north(base, 2));
    const customer = await login(ctx);
    const job = await scheduled(customer, base);
    const ask = (proId: string) =>
      customer.agent.post(`/v1/jobs/${job.id}/requests`).set(CLIENT_HEADER).send({ proId });

    await ask(first.userId).expect(201);
    const [offer] = await offersOf(first);
    await first.agent.post(`/v1/pro/offers/${offer!.id}/decline`).set(CLIENT_HEADER).expect(200);
    const back = await customer.agent.get(`/v1/jobs/${job.id}`).expect(200);
    expect(back.body.job.dispatch).toBe('CHOOSE_PRO');
    await ask(first.userId).expect(422);
    const list = await customer.agent.get(`/v1/jobs/${job.id}/pros`).expect(200);
    expect(list.body.pros.map((p: { id: string }) => p.id)).toEqual([second.userId]);

    await ask(second.userId).expect(201);
    await ctx.db
      .update(jobOffers)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(jobOffers.jobId, job.id));
    expect(await offersOf(second)).toEqual([]);
    const again = await customer.agent.get(`/v1/jobs/${job.id}`).expect(200);
    expect(again.body.job.dispatch).toBe('CHOOSE_PRO');
  });

  it('a request for a job soon is answered at the latest an hour before it', async () => {
    const base = somewhere();
    const p = await pro(north(base, 1));
    const customer = await login(ctx);
    const job = await scheduled(customer, base, 5);
    const sent = await customer.agent
      .post(`/v1/jobs/${job.id}/requests`)
      .set(CLIENT_HEADER)
      .send({ proId: p.userId })
      .expect(201);
    const left = new Date(sent.body.request.expiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(3.9 * 3_600_000);
    expect(left).toBeLessThan(4.1 * 3_600_000);
  });

  it('a scheduled request does not stop the Pro getting emergencies', async () => {
    const base = somewhere();
    const p = await pro(north(base, 1));
    const customer = await login(ctx);
    const job = await scheduled(customer, base);
    await customer.agent
      .post(`/v1/jobs/${job.id}/requests`)
      .set(CLIENT_HEADER)
      .send({ proId: p.userId })
      .expect(201);
    const urgent = await emergency(customer, base);
    expect(urgent.dispatch).toBe('OFFERED');
    expect((await offersOf(p)).map((o) => o.job.id).sort()).toEqual([job.id, urgent.id].sort());
  });
});
