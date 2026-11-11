import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  calls,
  categories,
  jobs,
  ledgerEntries,
  messages,
  payments,
  privateFiles,
  proCategories,
  proProfiles,
  quotes,
  skillChecks,
  users,
  verifications,
} from '../src/db/schema';
import { FIELD_CRYPTO } from '../src/infra/infra.module';
import { BalanceService } from '../src/work/balance.service';
import type { FieldCrypto } from '../src/common/field-crypto';
import { CLIENT_HEADER, createTestApp, login, randomPhone, type TestContext } from './helpers';

/**
 * Object-level authorization (IDOR) suite: no user can read or touch another user's data.
 * PRD section 9 requires this suite to pass on every pull request.
 */
let ctx: TestContext;
let electricianId: string;
let cleanerId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  const rows = await ctx.db.select().from(categories);
  electricianId = rows.find((c) => c.slug === 'electrician')!.id;
  cleanerId = rows.find((c) => c.slug === 'house-cleaner')!.id;
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.redis.flushdb();
});

const newJob = (categoryId: string, extra: Record<string, unknown> = {}) => ({
  categoryId,
  type: 'EMERGENCY',
  description: 'Power went off in the whole flat, need help fast',
  latitude: 7.6233,
  longitude: 5.2209,
  ...extra,
});

describe('jobs: object-level authorization', () => {
  it('a customer can create and read their own job', async () => {
    const alice = await login(ctx);
    const created = await alice.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId))
      .expect(201);
    const id = created.body.job.id as string;
    const got = await alice.agent.get(`/v1/jobs/${id}`).expect(200);
    expect(got.body.job.customerId).toBe(alice.userId);
  });

  it('another customer gets 404 (not 403) for someone else’s job', async () => {
    const alice = await login(ctx);
    const bob = await login(ctx);
    const created = await alice.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId))
      .expect(201);
    await bob.agent.get(`/v1/jobs/${created.body.job.id}`).expect(404);
  });

  it('a Pro who is not assigned cannot see the job; the assigned Pro can', async () => {
    const alice = await login(ctx);
    const assigned = await login(ctx, { role: 'pro' });
    const stranger = await login(ctx, { role: 'pro' });
    const created = await alice.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId))
      .expect(201);
    const id = created.body.job.id as string;

    await stranger.agent.get(`/v1/jobs/${id}`).expect(404);
    await ctx.db.update(jobs).set({ proId: assigned.userId }).where(eq(jobs.id, id));
    await assigned.agent.get(`/v1/jobs/${id}`).expect(200);
    await stranger.agent.get(`/v1/jobs/${id}`).expect(404);
  });

  it('job lists only ever contain the caller’s own jobs', async () => {
    const alice = await login(ctx);
    const bob = await login(ctx);
    await alice.agent.post('/v1/jobs').set(CLIENT_HEADER).send(newJob(electricianId)).expect(201);
    await bob.agent.post('/v1/jobs').set(CLIENT_HEADER).send(newJob(electricianId)).expect(201);
    const list = await bob.agent.get('/v1/jobs').expect(200);
    expect(list.body.jobs.length).toBeGreaterThan(0);
    for (const job of list.body.jobs) expect(job.customerId).toBe(bob.userId);
  });

  it('Pros cannot post jobs', async () => {
    const pro = await login(ctx, { role: 'pro' });
    await pro.agent.post('/v1/jobs').set(CLIENT_HEADER).send(newJob(electricianId)).expect(403);
  });

  it('rejects a customer-supplied customerId (no acting on behalf of others)', async () => {
    const alice = await login(ctx);
    const bob = await login(ctx);
    await alice.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId, { customerId: bob.userId }))
      .expect(400);
  });

  it('unauthenticated and malformed requests are refused', async () => {
    await request(ctx.server).get('/v1/jobs').expect(401);
    const alice = await login(ctx);
    await alice.agent.get('/v1/jobs/not-a-uuid').expect(400);
  });

  it('emergency requests only for emergency categories', async () => {
    const alice = await login(ctx);
    await alice.agent.post('/v1/jobs').set(CLIENT_HEADER).send(newJob(cleanerId)).expect(422);
  });
});

describe('no contact details, ever', () => {
  it('a public profile never includes the phone number', async () => {
    const pro = await login(ctx, { role: 'pro' });
    const customer = await login(ctx);
    const res = await customer.agent.get(`/v1/users/${pro.userId}`).expect(200);
    expect(res.body.user.phone).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(pro.phone.e164.slice(4));
  });

  it('phone numbers typed into a job description are hidden', async () => {
    const alice = await login(ctx);
    const res = await alice.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(
        newJob(electricianId, {
          description: 'Lights out, call me on 0803 123 4567 when you arrive',
        }),
      )
      .expect(201);
    expect(res.body.job.description).not.toMatch(/0803|4567/);
    expect(res.body.job.description).toContain('[hidden by GADMO]');
  });
});

describe('my account', () => {
  it('requires sign-in', async () => {
    await request(ctx.server).get('/v1/me').expect(401);
    await request(ctx.server).patch('/v1/me').set(CLIENT_HEADER).send({ name: 'Bola' }).expect(401);
  });

  it('returns only the caller’s own account, with their own phone', async () => {
    const alice = await login(ctx);
    const res = await alice.agent.get('/v1/me').expect(200);
    expect(res.body.user).toMatchObject({
      id: alice.userId,
      phone: alice.phone.e164,
      name: null,
      role: 'CUSTOMER',
      deletionRequestedAt: null,
    });
    expect(Object.keys(res.body.user).sort()).toEqual(
      ['createdAt', 'deletionRequestedAt', 'id', 'name', 'phone', 'role'].sort(),
    );
  });

  it('changes only the caller’s own name; role and other users stay untouched', async () => {
    const alice = await login(ctx);
    const bob = await login(ctx);
    await alice.agent
      .patch('/v1/me')
      .set(CLIENT_HEADER)
      .send({ name: 'Alice', role: 'ADMIN' })
      .expect(400);
    await alice.agent
      .patch('/v1/me')
      .set(CLIENT_HEADER)
      .send({ name: 'Alice', id: bob.userId })
      .expect(400);
    const res = await alice.agent
      .patch('/v1/me')
      .set(CLIENT_HEADER)
      .send({ name: ' Alice  Ade ' })
      .expect(200);
    expect(res.body.user).toMatchObject({ id: alice.userId, name: 'Alice Ade', role: 'CUSTOMER' });
    const bobNow = await bob.agent.get('/v1/me').expect(200);
    expect(bobNow.body.user.name).toBeNull();
  });

  it('refuses contact details in a name and requires the CSRF header', async () => {
    const alice = await login(ctx);
    await alice.agent
      .patch('/v1/me')
      .set(CLIENT_HEADER)
      .send({ name: 'Call 08031234567' })
      .expect(400);
    await alice.agent.patch('/v1/me').send({ name: 'Alice' }).expect(403);
  });

  it('other users see the name but never the phone', async () => {
    const pro = await login(ctx, { role: 'pro' });
    await pro.agent.patch('/v1/me').set(CLIENT_HEADER).send({ name: 'Tunde' }).expect(200);
    const customer = await login(ctx);
    const res = await customer.agent.get(`/v1/users/${pro.userId}`).expect(200);
    expect(res.body.user.name).toBe('Tunde');
    expect(res.body.user.phone).toBeUndefined();
  });
});

describe('account dashboard, privacy and sessions', () => {
  it('the summary counts only the caller’s own jobs and money', async () => {
    const customer = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    const created = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId, { latitude: -40 - Math.random(), longitude: -40 }))
      .expect(201);
    const id = created.body.job.id as string;
    const mine = await customer.agent.get('/v1/me/summary').expect(200);
    expect(mine.body.summary).toMatchObject({
      role: 'CUSTOMER',
      jobs: { open: 1, active: 0, completed: 0 },
      money: { balanceKobo: 0, spentKobo: 0 },
    });

    await ctx.db
      .update(jobs)
      .set({ proId: pro.userId, status: 'INSPECTION_PAID' })
      .where(eq(jobs.id, id));
    const txnId = crypto.randomUUID();
    await ctx.db.insert(ledgerEntries).values([
      { txnId, account: `escrow:job:${id}`, debitKobo: 150_000, jobId: id, description: 'test' },
      { txnId, account: `pro:${pro.userId}`, creditKobo: 150_000, jobId: id, description: 'test' },
    ]);
    const theirs = await pro.agent.get('/v1/me/summary').expect(200);
    expect(theirs.body.summary).toMatchObject({
      role: 'PRO',
      jobs: { active: 1 },
      money: { balanceKobo: 150_000, earnedKobo: 150_000 },
    });
    const stranger = await login(ctx);
    expect((await stranger.agent.get('/v1/me/summary').expect(200)).body.summary.jobs).toEqual({
      open: 0,
      active: 0,
      completed: 0,
      cancelled: 0,
    });
    await request(ctx.server).get('/v1/me/summary').expect(401);
  });

  it('exports only the caller’s own data, never the other side’s contact details', async () => {
    const customer = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    const created = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId, { latitude: -40 - Math.random(), longitude: -41 }))
      .expect(201);
    const id = created.body.job.id as string;
    await ctx.db.update(jobs).set({ proId: pro.userId, status: 'ACCEPTED' }).where(eq(jobs.id, id));
    await pro.agent
      .post(`/v1/jobs/${id}/messages`)
      .set(CLIENT_HEADER)
      .send({ body: 'From the Pro' })
      .expect(201);
    await customer.agent
      .post(`/v1/jobs/${id}/messages`)
      .set(CLIENT_HEADER)
      .send({ body: 'From me' })
      .expect(201);

    const res = await customer.agent.get('/v1/me/export').expect(200);
    expect(res.headers['content-disposition']).toContain('gadmo-my-data.json');
    const data = JSON.parse(res.text) as {
      account: { phone: string };
      jobs: { id: string }[];
      messagesYouSent: { body: string }[];
    };
    expect(data.account.phone).toBe(customer.phone.e164);
    expect(data.jobs.map((j) => j.id)).toEqual([id]);
    expect(data.messagesYouSent.map((m) => m.body)).toEqual(['From me']);
    expect(res.text).not.toContain(pro.phone.e164);
    expect(res.text).not.toContain('From the Pro');
    await request(ctx.server).get('/v1/me/export').expect(401);
  });

  it('a deletion request can be made and cancelled; sign out everywhere ends other sessions', async () => {
    const phone = randomPhone();
    const laptop = await login(ctx, { phone });
    const phoneSession = await login(ctx, { phone });
    await laptop.agent.post('/v1/me/deletion-request').send({}).expect(403); // CSRF
    await laptop.agent
      .post('/v1/me/deletion-request')
      .set(CLIENT_HEADER)
      .send({ reason: 'Moving abroad, call me on 08031234567', extra: 1 })
      .expect(400);
    const asked = await laptop.agent
      .post('/v1/me/deletion-request')
      .set(CLIENT_HEADER)
      .send({ reason: 'Moving abroad, call me on 08031234567' })
      .expect(200);
    expect(asked.body.user.deletionRequestedAt).not.toBeNull();
    const [log] = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.target, `user:${laptop.userId}`),
          eq(auditLogs.action, 'ACCOUNT_DELETION_REQUESTED'),
        ),
      );
    expect(JSON.stringify(log!.metadata)).not.toContain('08031234567');
    const cancelled = await laptop.agent
      .delete('/v1/me/deletion-request')
      .set(CLIENT_HEADER)
      .expect(200);
    expect(cancelled.body.user.deletionRequestedAt).toBeNull();

    await laptop.agent.post('/v1/me/sign-out-everywhere').set(CLIENT_HEADER).expect(204);
    await phoneSession.agent.post('/v1/auth/refresh').set(CLIENT_HEADER).expect(401);
    await laptop.agent.post('/v1/auth/refresh').set(CLIENT_HEADER).expect(401);
  });
});

describe('Pro profile', () => {
  const profile = (extra: Record<string, unknown> = {}) => ({
    categoryIds: [electricianId],
    bio: 'Licensed electrician, 8 years in Ado-Ekiti',
    latitude: 7.6233,
    longitude: 5.2209,
    serviceRadiusKm: 10,
    ...extra,
  });

  it('is only for signed-in Pros', async () => {
    await request(ctx.server).get('/v1/pro/profile').expect(401);
    const customer = await login(ctx);
    await customer.agent.get('/v1/pro/profile').expect(403);
    await customer.agent.put('/v1/pro/profile').set(CLIENT_HEADER).send(profile()).expect(403);
  });

  it('a new Pro starts empty and saves skills, bio and area', async () => {
    const pro = await login(ctx, { role: 'pro' });
    const empty = await pro.agent.get('/v1/pro/profile').expect(200);
    expect(empty.body.profile).toMatchObject({
      categoryIds: [],
      isOnline: false,
      verificationStatus: 'NOT_STARTED',
    });
    const saved = await pro.agent
      .put('/v1/pro/profile')
      .set(CLIENT_HEADER)
      .send(profile({ categoryIds: [electricianId, cleanerId] }))
      .expect(200);
    expect(saved.body.profile.categoryIds.sort()).toEqual([electricianId, cleanerId].sort());
    expect(saved.body.profile.serviceRadiusKm).toBe(10);
    // Saving again replaces the skills rather than adding to them.
    const again = await pro.agent.put('/v1/pro/profile').set(CLIENT_HEADER).send(profile());
    expect(again.body.profile.categoryIds).toEqual([electricianId]);
  });

  it('refuses group headings, unknown skills, odd distances, extra fields and no CSRF header', async () => {
    const pro = await login(ctx, { role: 'pro' });
    const [group] = await ctx.db.select().from(categories).where(isNull(categories.parentId));
    const put = (body: Record<string, unknown>) =>
      pro.agent.put('/v1/pro/profile').set(CLIENT_HEADER).send(body);
    await put(profile({ categoryIds: [group!.id] })).expect(422);
    await put(profile({ categoryIds: ['00000000-0000-4000-8000-000000000000'] })).expect(422);
    await put(profile({ serviceRadiusKm: 7 })).expect(400);
    await put(profile({ isOnline: true })).expect(400);
    await put(profile({ verificationStatus: 'APPROVED' })).expect(400);
    await pro.agent.put('/v1/pro/profile').send(profile()).expect(403);
  });

  it('hides contact details in the bio', async () => {
    const pro = await login(ctx, { role: 'pro' });
    const res = await pro.agent
      .put('/v1/pro/profile')
      .set(CLIENT_HEADER)
      .send(profile({ bio: 'Call me on 0803 123 4567 or tunde@gmail.com' }))
      .expect(200);
    expect(res.body.profile.bio).not.toMatch(/0803|4567|gmail/);
  });

  it('one Pro’s save never touches another Pro', async () => {
    const tunde = await login(ctx, { role: 'pro' });
    const kemi = await login(ctx, { role: 'pro' });
    await kemi.agent.put('/v1/pro/profile').set(CLIENT_HEADER).send(profile()).expect(200);
    await tunde.agent
      .put('/v1/pro/profile')
      .set(CLIENT_HEADER)
      .send(profile({ categoryIds: [cleanerId] }))
      .expect(200);
    const kemiNow = await kemi.agent.get('/v1/pro/profile').expect(200);
    expect(kemiNow.body.profile.categoryIds).toEqual([electricianId]);
  });

  it('the public profile shows skills and bio, never the location or phone', async () => {
    const pro = await login(ctx, { role: 'pro' });
    await pro.agent.put('/v1/pro/profile').set(CLIENT_HEADER).send(profile()).expect(200);
    const customer = await login(ctx);
    const res = await customer.agent.get(`/v1/users/${pro.userId}`).expect(200);
    expect(res.body.user.skills.map((s: { slug: string }) => s.slug)).toEqual(['electrician']);
    expect(res.body.user.bio).toContain('electrician');
    expect(res.body.user.latitude).toBeUndefined();
    expect(res.body.user.longitude).toBeUndefined();
    expect(res.body.user.phone).toBeUndefined();
  });
});

describe('Pro online switch and nearby requests', () => {
  const ADO = { latitude: 7.6233, longitude: 5.2209 };
  const LAGOS = { latitude: 6.4541, longitude: 3.3947 };

  async function verifiedPro(skills: string[] = [electricianId], online = true) {
    const pro = await login(ctx, { role: 'pro' });
    await pro.agent
      .put('/v1/pro/profile')
      .set(CLIENT_HEADER)
      .send({ categoryIds: skills, bio: '', ...ADO, serviceRadiusKm: 10 })
      .expect(200);
    await ctx.db
      .update(proProfiles)
      .set({ verificationStatus: 'APPROVED' })
      .where(eq(proProfiles.userId, pro.userId));
    if (online) {
      await pro.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true }).expect(200);
    }
    return pro;
  }

  async function postJob(customer: Awaited<ReturnType<typeof login>>, extra = {}) {
    const res = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId, { ...ADO, latitude: ADO.latitude + 0.01, ...extra }))
      .expect(201);
    return res.body.job.id as string;
  }

  it('customers and signed-out users cannot use Pro routes', async () => {
    await request(ctx.server).get('/v1/pro/jobs/nearby').expect(401);
    const customer = await login(ctx);
    await customer.agent.get('/v1/pro/jobs/nearby').expect(403);
    await customer.agent
      .post('/v1/pro/online')
      .set(CLIENT_HEADER)
      .send({ online: true })
      .expect(403);
  });

  it('only a verified Pro with skills and a place can go online', async () => {
    const pro = await login(ctx, { role: 'pro' });
    const goOnline = () =>
      pro.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true });
    await goOnline().expect(409);
    await ctx.db
      .update(proProfiles)
      .set({ verificationStatus: 'APPROVED' })
      .where(eq(proProfiles.userId, pro.userId));
    await goOnline().expect(409); // no skills or place yet
    await pro.agent
      .put('/v1/pro/profile')
      .set(CLIENT_HEADER)
      .send({ categoryIds: [electricianId], bio: '', ...ADO, serviceRadiusKm: 10 })
      .expect(200);
    const res = await goOnline().expect(200);
    expect(res.body.profile.isOnline).toBe(true);
    const off = await pro.agent
      .post('/v1/pro/online')
      .set(CLIENT_HEADER)
      .send({ online: false })
      .expect(200);
    expect(off.body.profile.isOnline).toBe(false);
    await pro.agent.post('/v1/pro/online').send({ online: true }).expect(403); // CSRF
    await pro.agent
      .post('/v1/pro/online')
      .set(CLIENT_HEADER)
      .send({ online: true, userId: 'x' })
      .expect(400);
  });

  it('unverified Pros see no requests; offline Pros get an empty list', async () => {
    const unverified = await login(ctx, { role: 'pro' });
    await unverified.agent.get('/v1/pro/jobs/nearby').expect(403);
    const offline = await verifiedPro([electricianId], false);
    const res = await offline.agent.get('/v1/pro/jobs/nearby').expect(200);
    expect(res.body).toEqual({ online: false, jobs: [] });
  });

  it('shows only open requests for the Pro’s skills within their distance', async () => {
    const customer = await login(ctx);
    const later = {
      type: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const near = await postJob(customer, later);
    const emergencyNear = await postJob(customer);
    const far = await postJob(customer, { ...LAGOS, ...later });
    const otherSkill = (
      await customer.agent
        .post('/v1/jobs')
        .set(CLIENT_HEADER)
        .send(
          newJob(cleanerId, {
            type: 'SCHEDULED',
            scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
            ...ADO,
          }),
        )
        .expect(201)
    ).body.job.id as string;
    const taken = await postJob(customer, later);
    const past = await postJob(customer, {
      type: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const other = await login(ctx, { role: 'pro' });
    await ctx.db
      .update(jobs)
      .set({ proId: other.userId, status: 'ACCEPTED' })
      .where(eq(jobs.id, taken));
    await ctx.db
      .update(jobs)
      .set({ scheduledAt: new Date(Date.now() - 3_600_000) })
      .where(eq(jobs.id, past));

    const pro = await verifiedPro();
    const res = await pro.agent.get('/v1/pro/jobs/nearby').expect(200);
    const ids = (res.body.jobs as { id: string }[]).map((j) => j.id);
    expect(ids).toContain(near);
    // Emergencies are offered one Pro at a time, never listed.
    for (const hidden of [far, otherSkill, taken, past, emergencyNear]) {
      expect(ids).not.toContain(hidden);
    }

    const job = res.body.jobs.find((j: { id: string }) => j.id === near);
    expect(job.distanceKm).toBeGreaterThanOrEqual(0.5);
    expect(job.distanceKm).toBeLessThanOrEqual(2);
    // No identity, coordinates or address before a Pro is assigned.
    for (const key of ['customerId', 'latitude', 'longitude', 'addressEncrypted', 'proId']) {
      expect(job[key]).toBeUndefined();
    }
  });
});

describe('emergency offers and cancelling: object-level authorization', () => {
  it('offers are for Pros only, and only their own', async () => {
    await request(ctx.server).get('/v1/pro/offers').expect(401);
    const customer = await login(ctx);
    await customer.agent.get('/v1/pro/offers').expect(403);

    const base = { latitude: 4 + Math.random(), longitude: 8 + Math.random() };
    const owner = await login(ctx, { role: 'pro' });
    await owner.agent
      .put('/v1/pro/profile')
      .set(CLIENT_HEADER)
      .send({ categoryIds: [electricianId], bio: '', ...base, serviceRadiusKm: 10 })
      .expect(200);
    await ctx.db
      .update(proProfiles)
      .set({ verificationStatus: 'APPROVED' })
      .where(eq(proProfiles.userId, owner.userId));
    await owner.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true }).expect(200);
    await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId, base))
      .expect(201);
    const [offer] = (await owner.agent.get('/v1/pro/offers').expect(200)).body.offers;

    const intruder = await login(ctx, { role: 'pro' });
    await intruder.agent.post(`/v1/pro/offers/${offer.id}/accept`).set(CLIENT_HEADER).expect(404);
    await intruder.agent.post(`/v1/pro/offers/${offer.id}/decline`).set(CLIENT_HEADER).expect(404);
    expect((await intruder.agent.get('/v1/pro/offers').expect(200)).body.offers).toEqual([]);
    await customer.agent.post(`/v1/pro/offers/${offer.id}/accept`).set(CLIENT_HEADER).expect(403);
    await owner.agent.post(`/v1/pro/offers/${offer.id}/accept`).expect(403); // CSRF
    await owner.agent.post('/v1/pro/offers/not-a-uuid/accept').set(CLIENT_HEADER).expect(400);
  });

  it('only the job’s own customer can cancel it', async () => {
    const alice = await login(ctx);
    const bob = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    const created = await alice.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId))
      .expect(201);
    const id = created.body.job.id as string;
    await bob.agent.post(`/v1/jobs/${id}/cancel`).set(CLIENT_HEADER).expect(404);
    await pro.agent.post(`/v1/jobs/${id}/cancel`).set(CLIENT_HEADER).expect(403);
    await alice.agent.post(`/v1/jobs/${id}/cancel`).expect(403); // CSRF
    const [row] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(row!.status).toBe('REQUESTED');
  });
});

const TRAINING = { trainedAt: 'Adeyemi Auto Workshop, Ado-Ekiti', trainedBy: 'Mr Adeyemi' };

describe('identity verification: Pros submit, nobody reads it back', () => {
  const jpeg = (size = 2000) =>
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 9)]);
  const upload = (agent: Awaited<ReturnType<typeof login>>['agent'], kind: string, body: Buffer) =>
    agent
      .put(`/v1/pro/verification/photos/${kind}`)
      .set(CLIENT_HEADER)
      .set('content-type', 'image/jpeg')
      .send(body);

  it('is for signed-in Pros only', async () => {
    await request(ctx.server).get('/v1/pro/verification').expect(401);
    const customer = await login(ctx);
    await customer.agent.get('/v1/pro/verification').expect(403);
    await upload(customer.agent, 'selfie', jpeg()).expect(403);
    await customer.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '12345678901', ...TRAINING })
      .expect(403);
  });

  it('a Pro uploads two photos and a NIN; it is stored encrypted and goes to review', async () => {
    const pro = await login(ctx, { role: 'pro' });
    const start = await pro.agent.get('/v1/pro/verification').expect(200);
    expect(start.body.verification).toMatchObject({
      status: 'NOT_STARTED',
      canSubmit: true,
      photos: { idDocument: false, selfie: false, attestation: false, certificate: false },
      techLinks: false,
    });

    // Not a photo, whatever the header says.
    await upload(pro.agent, 'selfie', Buffer.from('<svg onload="alert(1)"></svg>')).expect(415);
    await pro.agent
      .put('/v1/pro/verification/photos/selfie')
      .set(CLIENT_HEADER)
      .send({ image: 'x' })
      .expect(415);
    await upload(pro.agent, 'passport', jpeg()).expect(400);
    await upload(pro.agent, 'selfie', jpeg(2 * 1024 * 1024 + 10)).expect(413);
    await pro.agent
      .put('/v1/pro/verification/photos/selfie')
      .set('content-type', 'image/jpeg')
      .send(jpeg())
      .expect(403); // CSRF

    await upload(pro.agent, 'selfie', jpeg()).expect(204);
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '12345678901', ...TRAINING })
      .expect(422); // no ID photo yet
    await upload(pro.agent, 'id-document', jpeg(3000)).expect(204);
    await upload(pro.agent, 'id-document', jpeg(3100)).expect(204); // replaces the draft
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '12345678901', ...TRAINING })
      .expect(422); // no attestation letter or certificate yet
    await upload(pro.agent, 'attestation', jpeg(2500)).expect(204);
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '12345678901' })
      .expect(400); // where and with whom they trained is required
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '1234567890' })
      .expect(400);

    const res = await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '1234 5678 901', ...TRAINING })
      .expect(200);
    expect(res.body.verification).toMatchObject({ status: 'PENDING', canSubmit: false });
    expect(JSON.stringify(res.body)).not.toContain('12345678901');

    const [row] = await ctx.db
      .select()
      .from(verifications)
      .where(eq(verifications.proId, pro.userId));
    expect(row!.provider).toBe('manual');
    expect(row!.ninEncrypted).not.toContain('12345678901');
    const crypto = ctx.app.get<FieldCrypto>(FIELD_CRYPTO);
    expect(crypto.decrypt(row!.ninEncrypted!).toString()).toBe('12345678901');
    const files = await ctx.db
      .select()
      .from(privateFiles)
      .where(eq(privateFiles.ownerId, pro.userId));
    expect(files).toHaveLength(3);
    expect(files.every((f) => f.verificationId === row!.id)).toBe(true);
    const id = files.find((f) => f.purpose === 'ID_DOCUMENT')!;
    expect(id.byteSize).toBe(3104);
    expect(crypto.decrypt(id.dataEncrypted).equals(jpeg(3100))).toBe(true);
    const [profile] = await ctx.db
      .select()
      .from(proProfiles)
      .where(eq(proProfiles.userId, pro.userId));
    expect(profile!.verificationStatus).toBe('PENDING');
    expect(row!).toMatchObject({ ...TRAINING, trainerPhoneEncrypted: null, techLinks: null });
    expect(row!.attestationRef).toBe(
      `file:${files.find((f) => f.purpose === 'ATTESTATION_LETTER')!.id}`,
    );
    expect(row!.certificateRef).toBeNull();

    // While under review nothing can be changed.
    await upload(pro.agent, 'selfie', jpeg()).expect(409);
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '12345678901', ...TRAINING })
      .expect(409);
  });

  it('keeps the trainer phone encrypted, masks contact details, and takes links from tech Pros only', async () => {
    const send = async (pro: Awaited<ReturnType<typeof login>>) => {
      await upload(pro.agent, 'selfie', jpeg()).expect(204);
      await upload(pro.agent, 'id-document', jpeg()).expect(204);
      await upload(pro.agent, 'certificate', jpeg()).expect(204);
      await pro.agent
        .post('/v1/pro/verification')
        .set(CLIENT_HEADER)
        .send({
          nin: '12345678901',
          trainedAt: 'Ade Workshop, call 08031234567',
          trainedBy: 'Mr Ade',
          trainerPhone: '0803 123 4567',
          links: { linkedin: 'linkedin.com/in/ada', github: 'https://github.com/ada' },
        })
        .expect(200);
      const [row] = await ctx.db
        .select()
        .from(verifications)
        .where(eq(verifications.proId, pro.userId));
      return row!;
    };

    const plumber = await login(ctx, { role: 'pro' });
    const plain = await send(plumber);
    expect(plain.trainedAt).not.toContain('08031234567');
    expect(plain.trainerPhoneEncrypted).not.toContain('8031234567');
    const crypto = ctx.app.get<FieldCrypto>(FIELD_CRYPTO);
    expect(crypto.decrypt(plain.trainerPhoneEncrypted!).toString()).toBe('+2348031234567');
    expect(plain.techLinks).toBeNull(); // not a tech Pro
    expect(plain.certificateRef).toMatch(/^file:/);
    expect(plain.attestationRef).toBeNull();

    const developer = await login(ctx, { role: 'pro' });
    const [web] = await ctx.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, 'web-developer'));
    await ctx.db.insert(proCategories).values({ proId: developer.userId, categoryId: web!.id });
    const seen = await developer.agent.get('/v1/pro/verification').expect(200);
    expect(seen.body.verification.techLinks).toBe(true);
    const tech = await send(developer);
    expect(tech.techLinks).toEqual({
      linkedin: 'https://linkedin.com/in/ada',
      github: 'https://github.com/ada',
    });
    const res = await developer.agent.get('/v1/pro/verification').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('linkedin.com');
    expect(JSON.stringify(res.body)).not.toContain('8031234567');

    await developer.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '12345678901', ...TRAINING, links: { github: 'https://gitlab.com/x' } })
      .expect(400);
  });

  it('each Pro only ever sees their own check', async () => {
    const a = await login(ctx, { role: 'pro' });
    const b = await login(ctx, { role: 'pro' });
    await upload(a.agent, 'selfie', jpeg()).expect(204);
    const seen = await b.agent.get('/v1/pro/verification').expect(200);
    expect(seen.body.verification.photos.selfie).toBe(false);
  });

  it('a Pro asked for more information sees the note and can send again', async () => {
    const pro = await login(ctx, { role: 'pro' });
    await upload(pro.agent, 'selfie', jpeg()).expect(204);
    await upload(pro.agent, 'id-document', jpeg()).expect(204);
    await upload(pro.agent, 'attestation', jpeg()).expect(204);
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '12345678901', ...TRAINING })
      .expect(200);
    await ctx.db
      .update(verifications)
      .set({ result: 'NEEDS_INFO', reviewNote: 'The ID photo is blurred.' })
      .where(eq(verifications.proId, pro.userId));
    await ctx.db
      .update(proProfiles)
      .set({ verificationStatus: 'NEEDS_INFO' })
      .where(eq(proProfiles.userId, pro.userId));
    const res = await pro.agent.get('/v1/pro/verification').expect(200);
    expect(res.body.verification).toMatchObject({
      status: 'NEEDS_INFO',
      canSubmit: true,
      note: 'The ID photo is blurred.',
      photos: { idDocument: false, selfie: false, attestation: false, certificate: false },
    });
    await upload(pro.agent, 'id-document', jpeg()).expect(204);
  });
});

describe('staff review of identity checks', () => {
  const jpeg = (fill: number) =>
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1500, fill)]);

  async function submittedPro(nin = '22233344455') {
    const pro = await login(ctx, { role: 'pro' });
    for (const [kind, fill] of [
      ['id-document', 1],
      ['selfie', 2],
      ['attestation', 3],
    ] as const) {
      await pro.agent
        .put(`/v1/pro/verification/photos/${kind}`)
        .set(CLIENT_HEADER)
        .set('content-type', 'image/jpeg')
        .send(jpeg(fill))
        .expect(204);
    }
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin, ...TRAINING })
      .expect(200);
    const [row] = await ctx.db
      .select({ id: verifications.id })
      .from(verifications)
      .where(eq(verifications.proId, pro.userId));
    return { pro, checkId: row!.id };
  }

  async function staff() {
    const s = await login(ctx);
    await ctx.db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, s.userId));
    return s;
  }

  it('only staff can see the queue, a NIN, a photo or decide', async () => {
    const { pro, checkId } = await submittedPro();
    const customer = await login(ctx);
    const otherPro = await login(ctx, { role: 'pro' });
    for (const who of [customer, pro, otherPro]) {
      await who.agent.get('/v1/admin/verifications').expect(403);
      await who.agent.get(`/v1/admin/verifications/${checkId}`).expect(403);
      await who.agent.get(`/v1/admin/verifications/${checkId}/photos/selfie`).expect(403);
      await who.agent.get(`/v1/admin/verifications/${checkId}/photos/attestation`).expect(403);
      await who.agent
        .post(`/v1/admin/verifications/${checkId}/decision`)
        .set(CLIENT_HEADER)
        .send({ decision: 'APPROVED' })
        .expect(403);
    }
    await request(ctx.server).get('/v1/admin/verifications').expect(401);
    await request(ctx.server).get(`/v1/admin/verifications/${checkId}/photos/selfie`).expect(401);
  });

  it('staff see the queue, the NIN and the photos; every look is audit-logged', async () => {
    const nin = String(Math.floor(1e10 + Math.random() * 8e10));
    const { pro, checkId } = await submittedPro(nin);
    const reviewer = await staff();

    const queue = await reviewer.agent.get('/v1/admin/verifications').expect(200);
    const item = queue.body.verifications.find((v: { id: string }) => v.id === checkId);
    expect(item).toMatchObject({ proId: pro.userId, result: 'PENDING', ninUsedElsewhere: 0 });
    expect(JSON.stringify(queue.body)).not.toContain(nin);

    const detail = await reviewer.agent.get(`/v1/admin/verifications/${checkId}`).expect(200);
    expect(detail.body.verification).toMatchObject({
      nin,
      proPhone: pro.phone.e164,
      result: 'PENDING',
      ...TRAINING,
      trainerPhone: null,
      techLinks: null,
      documents: { attestation: true, certificate: false },
    });
    expect(detail.body.verification).not.toHaveProperty('trainerPhoneEncrypted');
    expect(detail.body.verification).not.toHaveProperty('attestationRef');

    const photo = await reviewer.agent
      .get(`/v1/admin/verifications/${checkId}/photos/selfie`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(photo.headers['content-type']).toContain('image/jpeg');
    expect(photo.headers['cache-control']).toContain('no-store');
    expect((photo.body as Buffer).equals(jpeg(2))).toBe(true);

    const logged = await ctx.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, reviewer.userId)));
    expect(logged.map((l) => l.action).sort()).toEqual(['VIEW_NIN', 'VIEW_SELFIE']);

    const letter = await reviewer.agent
      .get(`/v1/admin/verifications/${checkId}/photos/attestation`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((letter.body as Buffer).equals(jpeg(3))).toBe(true);
    await reviewer.agent.get(`/v1/admin/verifications/${checkId}/photos/certificate`).expect(404);

    await reviewer.agent.get('/v1/admin/verifications/not-a-uuid').expect(400);
    await reviewer.agent
      .get('/v1/admin/verifications/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });

  it('flags a NIN already used by another Pro account', async () => {
    const nin = String(Math.floor(1e10 + Math.random() * 8e10));
    await submittedPro(nin);
    const { checkId } = await submittedPro(nin);
    const reviewer = await staff();
    const detail = await reviewer.agent.get(`/v1/admin/verifications/${checkId}`).expect(200);
    expect(detail.body.verification.ninUsedElsewhere).toBe(1);
  });

  it('asking for more information sends a note back; the check can be decided once', async () => {
    const { pro, checkId } = await submittedPro();
    const reviewer = await staff();
    const decide = (body: Record<string, unknown>) =>
      reviewer.agent
        .post(`/v1/admin/verifications/${checkId}/decision`)
        .set(CLIENT_HEADER)
        .send(body);

    await decide({ decision: 'NEEDS_INFO' }).expect(400); // a note is required
    await decide({ decision: 'APPROVED', proId: pro.userId }).expect(400);
    await reviewer.agent
      .post(`/v1/admin/verifications/${checkId}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(403); // CSRF
    await decide({
      decision: 'NEEDS_INFO',
      note: 'The ID photo is blurred, please retake it.',
    }).expect(200);
    await decide({ decision: 'APPROVED' }).expect(409);

    const seen = await pro.agent.get('/v1/pro/verification').expect(200);
    expect(seen.body.verification).toMatchObject({
      status: 'NEEDS_INFO',
      canSubmit: true,
      note: 'The ID photo is blurred, please retake it.',
    });
    const [log] = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.actorId, reviewer.userId), eq(auditLogs.action, 'VERIFICATION_DECISION')),
      );
    expect(log!.metadata).toMatchObject({ decision: 'NEEDS_INFO', proId: pro.userId });
  });

  it('approved documents lead to a skill check; only a pass lets the Pro go online', async () => {
    const { pro, checkId } = await submittedPro();
    await pro.agent
      .put('/v1/pro/profile')
      .set(CLIENT_HEADER)
      .send({
        categoryIds: [electricianId],
        bio: '',
        latitude: 7.62,
        longitude: 5.22,
        serviceRadiusKm: 10,
      })
      .expect(200);
    await pro.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true }).expect(409);
    const reviewer = await staff();
    await reviewer.agent
      .post(`/v1/admin/verifications/${checkId}/decision`)
      .set(CLIENT_HEADER)
      .send({ decision: 'APPROVED' })
      .expect(200);
    // Documents approved, but not verified until the in-person skill check is passed.
    await pro.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true }).expect(409);
    const waiting = await pro.agent.get('/v1/pro/verification').expect(200);
    expect(waiting.body.verification).toMatchObject({
      status: 'SKILL_CHECK',
      canSubmit: false,
      skillCheck: { scheduledAt: null, visitPlace: null },
    });
    const [visit] = await ctx.db
      .select()
      .from(skillChecks)
      .where(eq(skillChecks.proId, pro.userId));
    expect(visit).toMatchObject({ verificationId: checkId, result: 'PENDING' });

    await reviewer.agent
      .post(`/v1/admin/skill-checks/${visit!.id}/schedule`)
      .set(CLIENT_HEADER)
      .send({
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        visitPlace: 'Workshop at Okesa, Ado-Ekiti',
      })
      .expect(200);
    const booked = await pro.agent.get('/v1/pro/verification').expect(200);
    expect(booked.body.verification.skillCheck.visitPlace).toBe('Workshop at Okesa, Ado-Ekiti');
    await reviewer.agent
      .post(`/v1/admin/skill-checks/${visit!.id}/result`)
      .set(CLIENT_HEADER)
      .send({ result: 'PASSED', note: 'Neat wiring, all the right tools, good past work.' })
      .expect(200);
    await pro.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true }).expect(200);
    const done = await pro.agent.get('/v1/pro/verification').expect(200);
    expect(done.body.verification).toMatchObject({ status: 'APPROVED', skillCheck: null });

    const second = await submittedPro();
    await reviewer.agent
      .post(`/v1/admin/verifications/${second.checkId}/decision`)
      .set(CLIENT_HEADER)
      .send({ decision: 'REJECTED', note: 'The selfie does not match the ID photo.' })
      .expect(200);
    const [profile] = await ctx.db
      .select()
      .from(proProfiles)
      .where(eq(proProfiles.userId, second.pro.userId));
    expect(profile).toMatchObject({ verificationStatus: 'REJECTED', isOnline: false });
  });
});

describe('skill checks: staff book a visit and record the result', () => {
  const jpeg = (fill: number) =>
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1500, fill)]);

  /** A Pro whose documents staff have approved, waiting for the skill check. */
  async function waitingPro() {
    const pro = await login(ctx, { role: 'pro' });
    for (const kind of ['id-document', 'selfie', 'certificate']) {
      await pro.agent
        .put(`/v1/pro/verification/photos/${kind}`)
        .set(CLIENT_HEADER)
        .set('content-type', 'image/jpeg')
        .send(jpeg(4))
        .expect(204);
    }
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '33344455566', ...TRAINING })
      .expect(200);
    const [check] = await ctx.db
      .select({ id: verifications.id })
      .from(verifications)
      .where(eq(verifications.proId, pro.userId));
    const reviewer = await login(ctx);
    await ctx.db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, reviewer.userId));
    await reviewer.agent
      .post(`/v1/admin/verifications/${check!.id}/decision`)
      .set(CLIENT_HEADER)
      .send({ decision: 'APPROVED' })
      .expect(200);
    const [visit] = await ctx.db
      .select({ id: skillChecks.id })
      .from(skillChecks)
      .where(eq(skillChecks.proId, pro.userId));
    return { pro, reviewer, visitId: visit!.id };
  }

  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

  it('only staff can see, book or record a skill check', async () => {
    const { pro, visitId } = await waitingPro();
    const customer = await login(ctx);
    const otherPro = await login(ctx, { role: 'pro' });
    for (const who of [customer, pro, otherPro]) {
      await who.agent.get('/v1/admin/skill-checks').expect(403);
      await who.agent.get(`/v1/admin/skill-checks/${visitId}`).expect(403);
      await who.agent
        .post(`/v1/admin/skill-checks/${visitId}/schedule`)
        .set(CLIENT_HEADER)
        .send({ scheduledAt: tomorrow(), visitPlace: 'Workshop' })
        .expect(403);
      await who.agent
        .post(`/v1/admin/skill-checks/${visitId}/result`)
        .set(CLIENT_HEADER)
        .send({ result: 'PASSED', note: 'Looks good to me.' })
        .expect(403);
    }
    await request(ctx.server).get('/v1/admin/skill-checks').expect(401);
    const [row] = await ctx.db.select().from(skillChecks).where(eq(skillChecks.id, visitId));
    expect(row!.result).toBe('PENDING');
  });

  it('staff see the queue and what the agent needs for the visit', async () => {
    const { pro, reviewer, visitId } = await waitingPro();
    const queue = await reviewer.agent.get('/v1/admin/skill-checks').expect(200);
    expect(queue.body.skillChecks.map((c: { id: string }) => c.id)).toContain(visitId);
    const detail = await reviewer.agent.get(`/v1/admin/skill-checks/${visitId}`).expect(200);
    expect(detail.body.skillCheck).toMatchObject({
      proId: pro.userId,
      proPhone: pro.phone.e164,
      result: 'PENDING',
      ...TRAINING,
    });
    await reviewer.agent.get('/v1/admin/skill-checks?status=bad').expect(400);
    await reviewer.agent
      .get('/v1/admin/skill-checks/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });

  it('validates the booking and the result, and needs the client header', async () => {
    const { reviewer, visitId } = await waitingPro();
    const book = (body: Record<string, unknown>) =>
      reviewer.agent
        .post(`/v1/admin/skill-checks/${visitId}/schedule`)
        .set(CLIENT_HEADER)
        .send(body);
    await book({ scheduledAt: 'tomorrow', visitPlace: 'Workshop' }).expect(400);
    await book({ scheduledAt: tomorrow() }).expect(400);
    await book({
      scheduledAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      visitPlace: 'Workshop',
    }).expect(422);
    await reviewer.agent
      .post(`/v1/admin/skill-checks/${visitId}/schedule`)
      .send({ scheduledAt: tomorrow(), visitPlace: 'Workshop' })
      .expect(403); // CSRF
    await book({ scheduledAt: tomorrow(), visitPlace: 'Workshop, call me on 08031234567' }).expect(
      200,
    );
    const [row] = await ctx.db.select().from(skillChecks).where(eq(skillChecks.id, visitId));
    expect(row!.visitPlace).not.toContain('08031234567');
    expect(row!.scheduledById).toBe(reviewer.userId);

    await reviewer.agent
      .post(`/v1/admin/skill-checks/${visitId}/result`)
      .set(CLIENT_HEADER)
      .send({ result: 'PASSED' })
      .expect(400); // a note is required
  });

  it('a failed check sends the Pro back with the agent’s note; it can be recorded once', async () => {
    const { pro, reviewer, visitId } = await waitingPro();
    const record = (body: Record<string, unknown>) =>
      reviewer.agent.post(`/v1/admin/skill-checks/${visitId}/result`).set(CLIENT_HEADER).send(body);
    await record({
      result: 'FAILED',
      note: 'Could not show a working repair; tools were borrowed.',
    }).expect(200);
    await record({ result: 'PASSED', note: 'Changed my mind.' }).expect(409);
    await reviewer.agent
      .post(`/v1/admin/skill-checks/${visitId}/schedule`)
      .set(CLIENT_HEADER)
      .send({ scheduledAt: tomorrow(), visitPlace: 'Workshop' })
      .expect(409);

    const seen = await pro.agent.get('/v1/pro/verification').expect(200);
    expect(seen.body.verification).toMatchObject({
      status: 'REJECTED',
      canSubmit: true,
      note: 'Could not show a working repair; tools were borrowed.',
      skillCheck: null,
    });
    await pro.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true }).expect(409);
    const [log] = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.actorId, reviewer.userId), eq(auditLogs.action, 'SKILL_CHECK_RESULT')),
      );
    expect(log!.metadata).toMatchObject({ result: 'FAILED', proId: pro.userId });
  });

  it('staff cannot check themselves', async () => {
    const { pro, visitId } = await waitingPro();
    await ctx.db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, pro.userId));
    await pro.agent
      .post(`/v1/admin/skill-checks/${visitId}/result`)
      .set(CLIENT_HEADER)
      .send({ result: 'PASSED', note: 'I am great at this.' })
      .expect(409);
  });
});

describe('job chat: only the customer and the assigned Pro, contact details hidden', () => {
  async function acceptedJob() {
    const customer = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    const created = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId, { latitude: 1 + Math.random(), longitude: 1 + Math.random() }))
      .expect(201);
    const id = created.body.job.id as string;
    return { customer, pro, id };
  }
  const assign = (id: string, proId: string) =>
    ctx.db.update(jobs).set({ proId, status: 'ACCEPTED' }).where(eq(jobs.id, id));

  it('opens only once a Pro has accepted', async () => {
    const { customer, id } = await acceptedJob();
    const convo = await customer.agent.get(`/v1/jobs/${id}/conversation`).expect(200);
    expect(convo.body.conversation).toMatchObject({ you: 'CUSTOMER', other: null, open: false });
    await customer.agent.get(`/v1/jobs/${id}/messages`).expect(409);
    await customer.agent
      .post(`/v1/jobs/${id}/messages`)
      .set(CLIENT_HEADER)
      .send({ body: 'Hello?' })
      .expect(409);
  });

  it('the two parties talk; nobody else can read or write', async () => {
    const { customer, pro, id } = await acceptedJob();
    await pro.agent.patch('/v1/me').set(CLIENT_HEADER).send({ name: 'Tunde' }).expect(200);
    await assign(id, pro.userId);

    const convo = await customer.agent.get(`/v1/jobs/${id}/conversation`).expect(200);
    expect(convo.body.conversation).toMatchObject({
      you: 'CUSTOMER',
      other: { id: pro.userId, name: 'Tunde' },
      open: true,
    });
    expect(JSON.stringify(convo.body)).not.toContain(pro.phone.e164);
    const proView = await pro.agent.get(`/v1/jobs/${id}/conversation`).expect(200);
    expect(proView.body.conversation.you).toBe('PRO');

    const sent = await customer.agent
      .post(`/v1/jobs/${id}/messages`)
      .set(CLIENT_HEADER)
      .send({ body: '  The sockets in the kitchen are dead  ' })
      .expect(201);
    expect(sent.body.message).toMatchObject({
      body: 'The sockets in the kitchen are dead',
      mine: true,
    });
    await pro.agent
      .post(`/v1/jobs/${id}/messages`)
      .set(CLIENT_HEADER)
      .send({ body: 'I can come at 3pm' })
      .expect(201);

    const seen = await pro.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(
      seen.body.messages.map((m: { body: string; mine: boolean }) => [m.body, m.mine]),
    ).toEqual([
      ['The sockets in the kitchen are dead', false],
      ['I can come at 3pm', true],
    ]);
    const after = await customer.agent
      .get(`/v1/jobs/${id}/messages`)
      .query({ afterSeq: sent.body.message.seq })
      .expect(200);
    expect(after.body.messages.map((m: { body: string }) => m.body)).toEqual(['I can come at 3pm']);
    await customer.agent.get(`/v1/jobs/${id}/messages`).query({ afterSeq: 'x' }).expect(400);
    // A server clock that jumps (as on some PCs) can't reorder the chat.
    await ctx.db
      .update(messages)
      .set({ createdAt: sql`now() + interval '5 hours'` })
      .where(eq(messages.id, sent.body.message.id));
    const ordered = await customer.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(ordered.body.messages.map((m: { body: string }) => m.body)).toEqual([
      'The sockets in the kitchen are dead',
      'I can come at 3pm',
    ]);

    const stranger = await login(ctx);
    const otherPro = await login(ctx, { role: 'pro' });
    for (const who of [stranger, otherPro]) {
      await who.agent.get(`/v1/jobs/${id}/conversation`).expect(404);
      await who.agent.get(`/v1/jobs/${id}/messages`).expect(404);
      await who.agent
        .post(`/v1/jobs/${id}/messages`)
        .set(CLIENT_HEADER)
        .send({ body: 'hi' })
        .expect(404);
    }
    await request(ctx.server).get(`/v1/jobs/${id}/messages`).expect(401);
    await customer.agent.post(`/v1/jobs/${id}/messages`).send({ body: 'hi' }).expect(403); // CSRF
  });

  it('phone numbers, emails and handles are hidden before storing, and the sender is flagged', async () => {
    const { customer, pro, id } = await acceptedJob();
    await assign(id, pro.userId);
    const res = await pro.agent
      .post(`/v1/jobs/${id}/messages`)
      .set(CLIENT_HEADER)
      .send({ body: 'Call me on 0803 123 4567 or WhatsApp, email tunde@gmail.com' })
      .expect(201);
    expect(res.body.message.wasMasked).toBe(true);
    expect(res.body.message.body).not.toMatch(/0803|4567|gmail/);
    expect(res.body.notice).toContain('Contact details were hidden');
    const stored = await ctx.db.select().from(messages).where(eq(messages.jobId, id));
    expect(stored[0]!.body).not.toMatch(/0803|4567|gmail/);
    const [sender] = await ctx.db.select().from(users).where(eq(users.id, pro.userId));
    expect(sender!.chatFlags).toBe(1);
    const seen = await customer.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(JSON.stringify(seen.body)).not.toMatch(/0803|4567|gmail/);
  });

  it('refuses empty or very long messages and closes when the job is cancelled', async () => {
    const { customer, pro, id } = await acceptedJob();
    await assign(id, pro.userId);
    const send = (body: Record<string, unknown>) =>
      customer.agent.post(`/v1/jobs/${id}/messages`).set(CLIENT_HEADER).send(body);
    await send({ body: '   ' }).expect(400);
    await send({ body: 'x'.repeat(1001) }).expect(400);
    await send({ body: 'hi', senderId: pro.userId }).expect(400);
    await ctx.db.update(jobs).set({ status: 'CANCELLED' }).where(eq(jobs.id, id));
    await send({ body: 'hello?' }).expect(409);
    await customer.agent.get(`/v1/jobs/${id}/messages`).expect(200);
  });
});

describe('chat photos, voice notes and location pins', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);

  async function chat(categoryId = electricianId) {
    const customer = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    const created = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(
        newJob(categoryId, {
          type: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          latitude: 1 + Math.random(),
          longitude: 1 + Math.random(),
        }),
      )
      .expect(201);
    const id = created.body.job.id as string;
    await ctx.db.update(jobs).set({ proId: pro.userId, status: 'ACCEPTED' }).where(eq(jobs.id, id));
    return { customer, pro, id };
  }
  const upload = (
    who: Awaited<ReturnType<typeof login>>,
    id: string,
    what: 'photo' | 'voice',
    type: string,
    bytes: Buffer,
  ) =>
    who.agent
      .post(`/v1/jobs/${id}/messages/${what}`)
      .set(CLIENT_HEADER)
      .set('content-type', type)
      .send(bytes);

  it('photos and voice notes reach the other party only, stored encrypted', async () => {
    const { customer, pro, id } = await chat();
    const sent = await upload(customer, id, 'photo', 'image/png', PNG).expect(201);
    expect(sent.body.message).toMatchObject({ kind: 'PHOTO', mine: true });
    const photoId = sent.body.message.fileId as string;
    const voice = await upload(pro, id, 'voice', 'audio/webm', WEBM).expect(201);
    expect(voice.body.message.kind).toBe('VOICE');

    const listed = await pro.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(listed.body.messages.map((m: { kind: string }) => m.kind)).toEqual(['PHOTO', 'VOICE']);
    const got = await pro.agent.get(`/v1/jobs/${id}/files/${photoId}`).expect(200);
    expect(got.headers['content-type']).toContain('image/png');
    expect(Buffer.from(got.body as Buffer).equals(PNG)).toBe(true);
    const audio = await customer.agent
      .get(`/v1/jobs/${id}/files/${voice.body.message.fileId}`)
      .expect(200);
    expect(audio.headers['content-type']).toContain('audio/webm');

    const [stored] = await ctx.db.select().from(privateFiles).where(eq(privateFiles.id, photoId));
    expect(stored!.dataEncrypted).not.toContain(PNG.toString('base64').slice(0, 20));

    // Nobody else, and not through another job.
    const stranger = await login(ctx);
    await stranger.agent.get(`/v1/jobs/${id}/files/${photoId}`).expect(404);
    await upload(stranger, id, 'photo', 'image/png', PNG).expect(404);
    const other = await chat();
    await other.customer.agent.get(`/v1/jobs/${other.id}/files/${photoId}`).expect(404);
    // CSRF, and only real images or audio.
    await customer.agent
      .post(`/v1/jobs/${id}/messages/photo`)
      .set('content-type', 'image/png')
      .send(PNG)
      .expect(403);
    await upload(customer, id, 'photo', 'image/png', Buffer.from('<svg onload=alert(1)>')).expect(
      400,
    );
    await upload(customer, id, 'voice', 'audio/webm', PNG).expect(400);
  });

  it('a customer shares their exact location only once the inspection fee is paid', async () => {
    const { customer, pro, id } = await chat();
    const pin = { latitude: 7.6233, longitude: 5.2209 };
    const share = (who: Awaited<ReturnType<typeof login>>, jobId: string, body: object) =>
      who.agent.post(`/v1/jobs/${jobId}/messages/location`).set(CLIENT_HEADER).send(body);
    await share(customer, id, pin).expect(409);
    await share(pro, id, pin).expect(201); // e.g. where the Pro's workshop is
    await share(pro, id, { latitude: 91, longitude: 0 }).expect(400);
    await share(pro, id, { ...pin, label: 'x' }).expect(400);

    await ctx.db.update(jobs).set({ status: 'INSPECTION_PAID' }).where(eq(jobs.id, id));
    const sent = await share(customer, id, pin).expect(201);
    expect(sent.body.message).toMatchObject({ kind: 'LOCATION', ...pin });
    const listed = await pro.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(listed.body.messages.at(-1)).toMatchObject({ kind: 'LOCATION', ...pin, mine: false });
    await share(await login(ctx), id, pin).expect(404);

    // Services with no inspection fee: straight away.
    const [none] = await ctx.db
      .select()
      .from(categories)
      .where(and(eq(categories.inspectionPolicy, 'NONE'), isNotNull(categories.parentId)))
      .limit(1);
    const noFee = await chat(none!.id);
    await share(noFee.customer, noFee.id, pin).expect(201);
  });
});

describe('in-app calls: only the job’s customer and Pro', () => {
  const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n';
  async function callable() {
    const customer = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    const created = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId, { latitude: 1 + Math.random(), longitude: 1 + Math.random() }))
      .expect(201);
    const id = created.body.job.id as string;
    return { customer, pro, id };
  }
  type Who = Awaited<ReturnType<typeof login>>;
  const start = (who: Who, id: string) =>
    who.agent.post(`/v1/jobs/${id}/calls`).set(CLIENT_HEADER).send({ sdp: SDP });
  const act = (who: Who, callId: string, action: 'answer' | 'decline' | 'end', body: object = {}) =>
    who.agent.post(`/v1/calls/${callId}/${action}`).set(CLIENT_HEADER).send(body);
  const current = (who: Who, id: string) =>
    who.agent
      .get(`/v1/jobs/${id}/calls/current`)
      .expect(200)
      .then((r) => r.body.call);

  it('the customer calls, the Pro answers, either hangs up; nobody else can listen in', async () => {
    const { customer, pro, id } = await callable();
    await start(customer, id).expect(409); // no Pro yet
    await ctx.db.update(jobs).set({ proId: pro.userId, status: 'ACCEPTED' }).where(eq(jobs.id, id));

    const started = await start(customer, id).expect(201);
    const callId = started.body.call.id as string;
    expect(started.body.call).toMatchObject({ status: 'RINGING', you: 'CALLER', offerSdp: null });
    await start(pro, id).expect(409); // one call at a time

    const ringing = await current(pro, id);
    expect(ringing).toMatchObject({ id: callId, you: 'CALLEE', offerSdp: SDP });
    const chat = await pro.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(chat.body.call).toEqual({ id: callId, status: 'RINGING', you: 'CALLEE' });

    const stranger = await login(ctx);
    await stranger.agent.get(`/v1/jobs/${id}/calls/current`).expect(404);
    await start(stranger, id).expect(404);
    for (const action of ['answer', 'decline', 'end'] as const) {
      await act(stranger, callId, action, { sdp: SDP }).expect(404);
    }
    await act(customer, callId, 'answer', { sdp: SDP }).expect(403); // can't answer yourself
    await pro.agent.post(`/v1/calls/${callId}/answer`).send({ sdp: SDP }).expect(403); // CSRF
    await act(pro, callId, 'answer', { sdp: 'x' }).expect(400);

    const answered = await act(pro, callId, 'answer', { sdp: `${SDP}a=answer\r\n` }).expect(200);
    expect(answered.body.call).toMatchObject({ status: 'ACTIVE', answerSdp: null });
    expect(await current(customer, id)).toMatchObject({
      status: 'ACTIVE',
      answerSdp: `${SDP}a=answer\r\n`,
      offerSdp: null,
    });
    await act(pro, callId, 'answer', { sdp: SDP }).expect(409);

    const ended = await act(customer, callId, 'end').expect(200);
    expect(ended.body.call.status).toBe('ENDED');
    expect(await current(pro, id)).toMatchObject({ id: callId, status: 'ENDED' });
    const after = await pro.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(after.body.messages.at(-1).body).toMatch(/^Call ended · 0:0\d$/);
    expect(after.body.call).toBeNull();
  });

  it('a call rings out as missed, can be declined, and a silent call ends', async () => {
    const { customer, pro, id } = await callable();
    await ctx.db.update(jobs).set({ proId: pro.userId, status: 'ACCEPTED' }).where(eq(jobs.id, id));
    const first = (await start(pro, id).expect(201)).body.call.id as string;
    await ctx.db
      .update(calls)
      .set({ createdAt: sql`now() - interval '1 minute'` })
      .where(eq(calls.id, first));
    expect(await current(customer, id)).toMatchObject({ id: first, status: 'MISSED' });
    await act(customer, first, 'answer', { sdp: SDP }).expect(409);

    const second = (await start(pro, id).expect(201)).body.call.id as string;
    await act(pro, second, 'decline').expect(403);
    expect((await act(customer, second, 'decline').expect(200)).body.call.status).toBe('DECLINED');

    const third = (await start(customer, id).expect(201)).body.call.id as string;
    await act(pro, third, 'answer', { sdp: SDP }).expect(200);
    await ctx.db
      .update(calls)
      .set({ calleeSeenAt: sql`now() - interval '1 minute'` })
      .where(eq(calls.id, third));
    expect(await current(customer, id)).toMatchObject({ id: third, status: 'ENDED' });

    const events = (await customer.agent.get(`/v1/jobs/${id}/messages`).expect(200)).body.messages
      .filter((m: { kind: string }) => m.kind === 'EVENT')
      .map((m: { body: string }) => m.body);
    expect(events.slice(0, 2)).toEqual(['Missed call.', 'Call declined.']);
    expect(events[2]).toMatch(/^Call ended/);
    expect(
      (await customer.agent.get('/v1/calls/ice-servers').expect(200)).body.iceServers[0].urls[0],
    ).toMatch(/^stun:/);
  });
});

describe('inspection fee agreed in chat (max ₦5,000)', () => {
  async function acceptedJob(categoryId = electricianId) {
    const customer = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    const created = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(
        newJob(categoryId, {
          type: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          latitude: 1 + Math.random(),
          longitude: 1 + Math.random(),
        }),
      )
      .expect(201);
    const id = created.body.job.id as string;
    await ctx.db.update(jobs).set({ proId: pro.userId, status: 'ACCEPTED' }).where(eq(jobs.id, id));
    return { customer, pro, id };
  }
  const propose = (agent: Awaited<ReturnType<typeof login>>['agent'], id: string, body: object) =>
    agent.post(`/v1/jobs/${id}/inspection-offers`).set(CLIENT_HEADER).send(body);
  const answer = (
    agent: Awaited<ReturnType<typeof login>>['agent'],
    offerId: string,
    action: 'accept' | 'decline' | 'counter',
    body: object = {},
  ) => agent.post(`/v1/inspection-offers/${offerId}/${action}`).set(CLIENT_HEADER).send(body);

  it('the Pro offers, the customer counters, the Pro accepts; the fee is stored on the job', async () => {
    const { customer, pro, id } = await acceptedJob();
    await propose(customer.agent, id, { amountKobo: 100_000 }).expect(403); // the Pro proposes
    await propose(pro.agent, id, { amountKobo: 500_100 }).expect(400); // over ₦5,000
    await propose(pro.agent, id, { amountKobo: 150_050 }).expect(400); // whole naira only
    await propose(pro.agent, id, { amountKobo: 0 }).expect(400);

    const first = await propose(pro.agent, id, {
      amountKobo: 250_000,
      note: 'About 8 km away, coming within the hour',
    }).expect(201);
    const offerId = first.body.offer.id as string;
    await propose(pro.agent, id, { amountKobo: 200_000 }).expect(409); // one at a time
    await answer(pro.agent, offerId, 'accept').expect(403); // not your own

    const counter = await answer(customer.agent, offerId, 'counter', {
      amountKobo: 150_000,
    }).expect(201);
    await answer(customer.agent, counter.body.offer.id, 'accept').expect(403);
    await answer(customer.agent, offerId, 'accept').expect(409); // already countered

    const agreed = await answer(pro.agent, counter.body.offer.id, 'accept').expect(200);
    expect(agreed.body.inspectionFeeKobo).toBe(150_000);
    const [row] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(row!.inspectionFeeKobo).toBe(150_000);
    expect(row!.inspectionAgreedAt).not.toBeNull();
    await propose(pro.agent, id, { amountKobo: 100_000 }).expect(409); // already agreed

    const chat = await customer.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(chat.body.messages.map((m: { kind: string; body: string }) => [m.kind, m.body])).toEqual(
      [
        ['OFFER', 'Inspection fee offer: ₦2,500. About 8 km away, coming within the hour'],
        ['OFFER', 'Inspection fee offer: ₦1,500'],
        ['EVENT', 'Inspection fee agreed: ₦1,500.'],
      ],
    );
    expect(chat.body.inspectionFeeKobo).toBe(150_000);
    expect(chat.body.offers.map((o: { status: string }) => o.status).sort()).toEqual([
      'ACCEPTED',
      'COUNTERED',
    ]);
  });

  it('after a decline the Pro can make a new offer', async () => {
    const { customer, pro, id } = await acceptedJob();
    const first = await propose(pro.agent, id, { amountKobo: 500_000 }).expect(201);
    await answer(customer.agent, first.body.offer.id, 'decline').expect(200);
    await answer(customer.agent, first.body.offer.id, 'decline').expect(409);
    await propose(pro.agent, id, { amountKobo: 300_000 }).expect(201);
  });

  it('nobody else can see, make or answer offers', async () => {
    const { pro, id } = await acceptedJob();
    const offer = await propose(pro.agent, id, { amountKobo: 200_000 }).expect(201);
    const stranger = await login(ctx);
    const otherPro = await login(ctx, { role: 'pro' });
    for (const who of [stranger, otherPro]) {
      await propose(who.agent, id, { amountKobo: 100_000 }).expect(404);
      for (const action of ['accept', 'decline'] as const) {
        await answer(who.agent, offer.body.offer.id, action).expect(404);
      }
      await answer(who.agent, offer.body.offer.id, 'counter', { amountKobo: 100_000 }).expect(404);
    }
    await pro.agent
      .post(`/v1/jobs/${id}/inspection-offers`)
      .send({ amountKobo: 100_000 })
      .expect(403); // CSRF
  });

  it('services without an inspection fee refuse offers; contact details in a note are hidden', async () => {
    const [none] = await ctx.db
      .select()
      .from(categories)
      .where(and(eq(categories.inspectionPolicy, 'NONE'), isNotNull(categories.parentId)))
      .limit(1);
    const noFee = await acceptedJob(none!.id);
    await propose(noFee.pro.agent, noFee.id, { amountKobo: 100_000 }).expect(409);

    const { pro, id } = await acceptedJob();
    const res = await propose(pro.agent, id, {
      amountKobo: 100_000,
      note: 'Transport is far, call 0803 123 4567',
    }).expect(201);
    expect(res.body.offer.note).not.toMatch(/0803|4567/);
  });
});

describe('paying the inspection fee (test checkout)', () => {
  async function agreedJob(feeKobo: number | null = 200_000) {
    const customer = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    const created = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(
        newJob(electricianId, {
          type: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          latitude: 1 + Math.random(),
          longitude: 1 + Math.random(),
        }),
      )
      .expect(201);
    const id = created.body.job.id as string;
    await ctx.db
      .update(jobs)
      .set({ proId: pro.userId, status: 'ACCEPTED', inspectionFeeKobo: feeKobo })
      .where(eq(jobs.id, id));
    return { customer, pro, id };
  }
  const pay = (agent: Awaited<ReturnType<typeof login>>['agent'], id: string) =>
    agent.post(`/v1/jobs/${id}/inspection-fee/pay`).set(CLIENT_HEADER).send();
  const complete = (
    agent: Awaited<ReturnType<typeof login>>['agent'],
    ref: string,
    outcome: 'success' | 'failed',
  ) => agent.post(`/v1/payments/test/${ref}/complete`).set(CLIENT_HEADER).send({ outcome });

  it('the customer pays; the fee is held by GADMO in balanced ledger entries, once', async () => {
    const { customer, pro, id } = await agreedJob();
    const started = await pay(customer.agent, id).expect(200);
    const ref = started.body.reference as string;
    expect(ref).toMatch(/^gadmo_[0-9a-f]{32}$/);
    expect(started.body.authorizationUrl).toBe(`http://localhost:3000/pay/test?reference=${ref}`);
    // Tapping Pay again reuses the same checkout.
    expect((await pay(customer.agent, id).expect(200)).body.reference).toBe(ref);

    const page = await customer.agent.get(`/v1/payments/test/${ref}`).expect(200);
    expect(page.body.payment).toMatchObject({ jobId: id, amountKobo: 200_000, status: 'PENDING' });
    // Not paid until the provider says so.
    const before = await customer.agent
      .post(`/v1/payments/${ref}/check`)
      .set(CLIENT_HEADER)
      .expect(200);
    expect(before.body.payment.status).toBe('PENDING');

    const done = await complete(customer.agent, ref, 'success').expect(200);
    expect(done.body.payment.status).toBe('SUCCEEDED');
    await complete(customer.agent, ref, 'success').expect(200);
    await customer.agent.post(`/v1/payments/${ref}/check`).set(CLIENT_HEADER).expect(200);

    const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(job!.status).toBe('INSPECTION_PAID');
    const entries = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.jobId, id));
    expect(entries.map((e) => [e.account, e.debitKobo, e.creditKobo]).sort()).toEqual(
      [
        ['gateway:test:clearing', 200_000, 0],
        [`escrow:job:${id}`, 0, 200_000],
      ].sort(),
    );
    const chat = await pro.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(chat.body.messages.at(-1).body).toBe(
      'Inspection fee paid: ₦2,000. GADMO holds it until the Pro arrives and enters the customer’s arrival code.',
    );
    await pay(customer.agent, id).expect(409); // already paid
  });

  it('the Pro enters the customer’s arrival code; the fee is released to the Pro', async () => {
    const { customer, pro, id } = await agreedJob(250_000);
    const ref = (await pay(customer.agent, id).expect(200)).body.reference as string;
    const visit = (who: typeof pro, path: 'on-the-way' | 'arrived', body: object = {}) =>
      who.agent.post(`/v1/jobs/${id}/${path}`).set(CLIENT_HEADER).send(body);
    await visit(pro, 'on-the-way').expect(409); // not paid yet
    await complete(customer.agent, ref, 'success').expect(200);

    const mine = await customer.agent.get(`/v1/jobs/${id}/conversation`).expect(200);
    const code = mine.body.conversation.job.arrivalCode as string;
    expect(code).toMatch(/^\d{4}$/);
    const theirs = await pro.agent.get(`/v1/jobs/${id}/conversation`).expect(200);
    expect(theirs.body.conversation.job.arrivalCode).toBeNull();
    expect(JSON.stringify(theirs.body)).not.toContain(`"${code}"`);

    const stranger = await login(ctx);
    await visit(stranger, 'on-the-way').expect(404);
    await visit(stranger, 'arrived', { code }).expect(404);
    await visit(customer, 'arrived', { code }).expect(403);
    await pro.agent.post(`/v1/jobs/${id}/arrived`).send({ code }).expect(403); // CSRF

    const onWay = await visit(pro, 'on-the-way').expect(200);
    expect(onWay.body.visit.onTheWayAt).not.toBeNull();
    const wrong = code === '0000' ? '1111' : '0000';
    await visit(pro, 'arrived', { code: wrong }).expect(422);
    await visit(pro, 'arrived', { code: '12' }).expect(400);
    const ok = await visit(pro, 'arrived', { code }).expect(200);
    expect(ok.body.visit.arrivedAt).not.toBeNull();
    await visit(pro, 'arrived', { code }).expect(409); // only once

    const entries = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.jobId, id));
    const balance = (account: string) =>
      entries
        .filter((e) => e.account === account)
        .reduce((sum, e) => sum + e.creditKobo - e.debitKobo, 0);
    expect(balance(`escrow:job:${id}`)).toBe(0);
    expect(balance(`pro:${pro.userId}`)).toBe(250_000);
    const after = await customer.agent.get(`/v1/jobs/${id}/conversation`).expect(200);
    expect(after.body.conversation.job.arrivalCode).toBeNull();
    const chat = await customer.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(chat.body.messages.map((m: { body: string }) => m.body).slice(-2)).toEqual([
      'Your Pro is on the way.',
      'Your Pro has arrived (arrival code confirmed). The inspection fee of ₦2,500 is now paid to the Pro.',
    ]);
    expect(chat.body.visit.arrivedAt).not.toBeNull();
  });

  it('a job paid before arrival codes existed gets one when the customer opens the chat', async () => {
    const { customer, pro, id } = await agreedJob();
    await ctx.db.update(jobs).set({ status: 'INSPECTION_PAID' }).where(eq(jobs.id, id));
    await pro.agent.post(`/v1/jobs/${id}/on-the-way`).set(CLIENT_HEADER).expect(200);
    const early = await pro.agent
      .post(`/v1/jobs/${id}/arrived`)
      .set(CLIENT_HEADER)
      .send({ code: '1234' })
      .expect(409);
    expect(early.body.message).toContain('open this job’s chat');

    const first = await customer.agent.get(`/v1/jobs/${id}/conversation`).expect(200);
    const code = first.body.conversation.job.arrivalCode as string;
    expect(code).toMatch(/^\d{4}$/);
    const again = await customer.agent.get(`/v1/jobs/${id}/conversation`).expect(200);
    expect(again.body.conversation.job.arrivalCode).toBe(code); // the same code every time
    const theirs = await pro.agent.get(`/v1/jobs/${id}/conversation`).expect(200);
    expect(theirs.body.conversation.job.arrivalCode).toBeNull();
    await pro.agent.post(`/v1/jobs/${id}/arrived`).set(CLIENT_HEADER).send({ code }).expect(200);
  });

  it('wrong arrival codes are limited, so the code can’t be guessed', async () => {
    const { customer, pro, id } = await agreedJob();
    const ref = (await pay(customer.agent, id).expect(200)).body.reference as string;
    await complete(customer.agent, ref, 'success').expect(200);
    const code = (await customer.agent.get(`/v1/jobs/${id}/conversation`).expect(200)).body
      .conversation.job.arrivalCode as string;
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) {
      await pro.agent
        .post(`/v1/jobs/${id}/arrived`)
        .set(CLIENT_HEADER)
        .send({ code: wrong })
        .expect(422);
    }
    await pro.agent.post(`/v1/jobs/${id}/arrived`).set(CLIENT_HEADER).send({ code }).expect(429);
  });

  it('a failed payment leaves the fee unpaid and can be tried again', async () => {
    const { customer, id } = await agreedJob();
    const ref = (await pay(customer.agent, id).expect(200)).body.reference as string;
    const failed = await complete(customer.agent, ref, 'failed').expect(200);
    expect(failed.body.payment.status).toBe('FAILED');
    const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(job!.status).toBe('ACCEPTED');
    const again = await pay(customer.agent, id).expect(200);
    expect(again.body.reference).not.toBe(ref);
  });

  it('only the job’s customer can pay or see a payment, and only once a fee is agreed', async () => {
    const { customer, pro, id } = await agreedJob();
    const ref = (await pay(customer.agent, id).expect(200)).body.reference as string;
    const stranger = await login(ctx);
    await pay(stranger.agent, id).expect(404);
    await pay(pro.agent, id).expect(403);
    for (const who of [stranger, pro]) {
      await who.agent
        .post(`/v1/payments/${ref}/check`)
        .set(CLIENT_HEADER)
        .expect(who === pro ? 403 : 404);
      await who.agent.get(`/v1/payments/test/${ref}`).expect(who === pro ? 403 : 404);
      await complete(who.agent, ref, 'success').expect(who === pro ? 403 : 404);
    }
    await customer.agent.post(`/v1/jobs/${id}/inspection-fee/pay`).send().expect(403); // CSRF
    await customer.agent.get('/v1/payments/test/not-a-reference').expect(400);
    const [p] = await ctx.db.select().from(payments).where(eq(payments.paystackReference, ref));
    expect(p!.status).toBe('PENDING');

    const notAgreed = await agreedJob(null);
    await pay(notAgreed.customer.agent, notAgreed.id).expect(409);
    // The Paystack webhook is off while the test checkout is in use.
    await request(ctx.server).post('/v1/payments/paystack/webhook').send({}).expect(404);
  });
});

describe('quotes and the materials deposit', () => {
  type Who = Awaited<ReturnType<typeof login>>;
  async function jobFor(categoryId: string, patch: Partial<typeof jobs.$inferInsert> = {}) {
    const customer = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    const created = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(
        newJob(categoryId, {
          type: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          latitude: 2 + Math.random(),
          longitude: 2 + Math.random(),
        }),
      )
      .expect(201);
    const id = created.body.job.id as string;
    await ctx.db
      .update(jobs)
      .set({ proId: pro.userId, status: 'ACCEPTED', ...patch })
      .where(eq(jobs.id, id));
    return { customer, pro, id };
  }
  const quote = (who: Who, id: string, body: object) =>
    who.agent.post(`/v1/jobs/${id}/quotes`).set(CLIENT_HEADER).send(body);
  const act = (who: Who, quoteId: string, action: 'accept' | 'decline' | 'withdraw') =>
    who.agent.post(`/v1/quotes/${quoteId}/${action}`).set(CLIENT_HEADER).send();

  it('services without an inspection: the Pro quotes, the customer accepts; nobody else can', async () => {
    const [none] = await ctx.db
      .select()
      .from(categories)
      .where(and(eq(categories.inspectionPolicy, 'NONE'), isNotNull(categories.parentId)))
      .limit(1);
    const { customer, pro, id } = await jobFor(none!.id);
    const body = { amountKobo: 1_500_000, description: 'Wedding cake, 3 tiers. Call 08031234567' };
    await quote(customer, id, body).expect(403);
    const stranger = await login(ctx, { role: 'pro' });
    await quote(stranger, id, body).expect(404);
    await quote(pro, id, { ...body, depositKobo: 800_000 }).expect(400); // over half
    await quote(pro, id, { ...body, amountKobo: 1_500_050 }).expect(400); // whole naira
    await pro.agent.post(`/v1/jobs/${id}/quotes`).send(body).expect(403); // CSRF

    const sent = await quote(pro, id, body).expect(201);
    expect(sent.body.quote).toMatchObject({
      amountKobo: 1_500_000,
      depositKobo: 0,
      status: 'PENDING',
    });
    expect(sent.body.quote.description).not.toContain('08031234567');
    await quote(pro, id, body).expect(409); // one at a time
    const quoteId = sent.body.quote.id as string;

    await act(pro, quoteId, 'accept').expect(403);
    await act(stranger, quoteId, 'accept').expect(404);
    await act(customer, quoteId, 'withdraw').expect(403);
    const accepted = await act(customer, quoteId, 'accept').expect(200);
    expect(accepted.body.quote.status).toBe('ACCEPTED');
    await act(customer, quoteId, 'decline').expect(409);
    const [row] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(row!.status).toBe('QUOTE_ACCEPTED');

    const chat = await customer.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    const card = chat.body.messages.find((m: { kind: string }) => m.kind === 'QUOTE');
    expect(card.quote).toMatchObject({ id: quoteId, amountKobo: 1_500_000 });
    expect(chat.body.quotes).toEqual([{ id: quoteId, status: 'ACCEPTED' }]);

    // No deposit and no inspection fee: the whole quote is the balance.
    const begun = await pro.agent.post(`/v1/jobs/${id}/start-work`).set(CLIENT_HEADER).expect(200);
    expect(begun.body.depositReleasedKobo).toBe(0);
    const done = await pro.agent.post(`/v1/jobs/${id}/work-done`).set(CLIENT_HEADER).expect(200);
    expect(done.body.balanceKobo).toBe(1_500_000);
  });

  it('repairs: quote after arriving; a deposit is paid in the app, straight to the Pro', async () => {
    const { customer, pro, id } = await jobFor(electricianId, {
      status: 'INSPECTION_PAID',
      inspectionFeeKobo: 200_000,
    });
    const body = { amountKobo: 2_000_000, depositKobo: 800_000, description: 'Rewire the kitchen' };
    await quote(pro, id, body).expect(409); // not arrived yet
    await ctx.db.update(jobs).set({ arrivedAt: new Date() }).where(eq(jobs.id, id));
    await quote(pro, id, { ...body, amountKobo: 100_000, depositKobo: 0 }).expect(422); // below the fee

    // Declined, then a new quote; the Pro can also withdraw one.
    const first = await quote(pro, id, body).expect(201);
    await act(customer, first.body.quote.id, 'decline').expect(200);
    let [row] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(row!.status).toBe('INSPECTION_PAID');
    const second = await quote(pro, id, body).expect(201);
    await act(pro, second.body.quote.id, 'withdraw').expect(200);
    const third = await quote(pro, id, body).expect(201);
    const quoteId = third.body.quote.id as string;

    const started = await act(customer, quoteId, 'accept').expect(200);
    const ref = started.body.payment.reference as string;
    expect(started.body.payment.authorizationUrl).toContain('/pay/test?reference=');
    [row] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(row!.status).toBe('QUOTED'); // accepted only once the deposit is paid

    await customer.agent
      .post(`/v1/payments/test/${ref}/complete`)
      .set(CLIENT_HEADER)
      .send({ outcome: 'success' })
      .expect(200);
    [row] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(row!.status).toBe('QUOTE_ACCEPTED');
    const entries = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.jobId, id));
    // Straight to the Pro, to buy materials; nothing is held for it.
    expect(entries.find((e) => e.account === `pro:${pro.userId}`)!.creditKobo).toBe(800_000);
    expect(entries.some((e) => e.account === `escrow:job:${id}`)).toBe(false);
    const chat = await pro.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(chat.body.messages.at(-1).body).toBe(
      'Quote of ₦20,000 accepted. Materials deposit of ₦8,000 paid to the Pro for materials.',
    );
    await act(customer, quoteId, 'accept').expect(409);
  });

  it('work: only the Pro starts it and marks it done; the balance is then due', async () => {
    const { customer, pro, id } = await jobFor(electricianId, {
      status: 'INSPECTION_PAID',
      inspectionFeeKobo: 300_000,
      arrivedAt: new Date(),
    });
    const stranger = await login(ctx, { role: 'pro' });
    const work = (who: Who, step: 'start-work' | 'work-done') =>
      who.agent.post(`/v1/jobs/${id}/${step}`).set(CLIENT_HEADER).send();

    await work(pro, 'start-work').expect(409); // no accepted quote yet
    const sent = await quote(pro, id, {
      amountKobo: 2_500_000,
      depositKobo: 1_000_000,
      description: 'Replace the distribution board',
    }).expect(201);
    const started = await act(customer, sent.body.quote.id, 'accept').expect(200);
    await customer.agent
      .post(`/v1/payments/test/${started.body.payment.reference}/complete`)
      .set(CLIENT_HEADER)
      .send({ outcome: 'success' })
      .expect(200);

    await work(customer, 'start-work').expect(403);
    await work(stranger, 'start-work').expect(404);
    await pro.agent.post(`/v1/jobs/${id}/start-work`).send().expect(403); // CSRF
    await work(pro, 'work-done').expect(409); // not started

    const begun = await work(pro, 'start-work').expect(200);
    expect(begun.body).toMatchObject({
      job: { status: 'IN_PROGRESS' },
      depositReleasedKobo: 0, // already in the Pro's wallet since it was paid
    });
    await work(pro, 'start-work').expect(409);
    const entries = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.jobId, id));
    const sum = (account: string) =>
      entries
        .filter((e) => e.account === account)
        .reduce((n, e) => n + e.creditKobo - e.debitKobo, 0);
    expect(sum(`escrow:job:${id}`)).toBe(0);
    expect(sum(`pro:${pro.userId}`)).toBe(1_000_000);

    await work(customer, 'work-done').expect(403);
    await work(stranger, 'work-done').expect(404);
    const finished = await work(pro, 'work-done').expect(200);
    // ₦25,000 quote − ₦3,000 inspection fee − ₦10,000 deposit.
    expect(finished.body).toMatchObject({
      job: { status: 'DONE_AWAITING_PAYMENT' },
      balanceKobo: 1_200_000,
    });
    expect(finished.body.job.doneAt).toBeTruthy();
    await work(pro, 'work-done').expect(409);

    const chat = await customer.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(chat.body.work).toMatchObject({ balanceKobo: 1_200_000 });
    expect(chat.body.messages.at(-1).body).toBe(
      'Your Pro marked the job done. Balance to pay: ₦12,000.',
    );
    const convo = await customer.agent.get(`/v1/jobs/${id}/conversation`).expect(200);
    expect(convo.body.conversation.job).toMatchObject({ balanceKobo: 1_200_000 });
    expect(convo.body.conversation.job.startedAt).toBeTruthy();
    await stranger.agent.get(`/v1/jobs/${id}/messages`).expect(404);
  });

  it('a deposit GADMO was still holding from before is released when work starts', async () => {
    const { pro, id } = await jobFor(electricianId, { status: 'QUOTE_ACCEPTED' });
    await ctx.db.insert(quotes).values({
      jobId: id,
      amountKobo: 2_000_000,
      depositKobo: 600_000,
      description: 'Old quote',
      status: 'ACCEPTED',
      acceptedAt: new Date(),
    });
    const txnId = crypto.randomUUID();
    await ctx.db.insert(ledgerEntries).values([
      {
        txnId,
        account: 'gateway:test:clearing',
        debitKobo: 600_000,
        jobId: id,
        description: 'Old',
      },
      { txnId, account: `escrow:job:${id}`, creditKobo: 600_000, jobId: id, description: 'Old' },
    ]);
    const begun = await pro.agent.post(`/v1/jobs/${id}/start-work`).set(CLIENT_HEADER).expect(200);
    expect(begun.body.depositReleasedKobo).toBe(600_000);
  });
});

describe('the balance: paid in the app, held 12 hours, then released with commission', () => {
  type Who = Awaited<ReturnType<typeof login>>;

  /** A job whose Pro has finished the work: a ₦25,000 quote, ₦3,000 inspection fee, ₦10,000 deposit. */
  async function finishedJob(quoteKobo = 2_500_000, depositKobo = 1_000_000, feeKobo = 300_000) {
    const customer = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    const created = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(
        newJob(electricianId, {
          type: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          latitude: 2 + Math.random(),
          longitude: 2 + Math.random(),
        }),
      )
      .expect(201);
    const id = created.body.job.id as string;
    await ctx.db
      .update(jobs)
      .set({
        proId: pro.userId,
        status: 'IN_PROGRESS',
        inspectionFeeKobo: feeKobo,
        arrivedAt: new Date(),
        startedAt: new Date(),
      })
      .where(eq(jobs.id, id));
    await ctx.db.insert(quotes).values({
      jobId: id,
      amountKobo: quoteKobo,
      depositKobo,
      description: 'Replace the distribution board',
      status: 'ACCEPTED',
      acceptedAt: new Date(),
    });
    // The deposit was paid straight to the Pro when the quote was accepted.
    if (depositKobo > 0) {
      const txnId = crypto.randomUUID();
      await ctx.db.insert(ledgerEntries).values([
        {
          txnId,
          account: 'gateway:test:clearing',
          debitKobo: depositKobo,
          jobId: id,
          description: 'Deposit',
        },
        {
          txnId,
          account: `pro:${pro.userId}`,
          creditKobo: depositKobo,
          jobId: id,
          description: 'Deposit',
        },
      ]);
    }
    await pro.agent.post(`/v1/jobs/${id}/work-done`).set(CLIENT_HEADER).expect(200);
    return { customer, pro, id };
  }

  const sum = async (account: string) => {
    const rows = await ctx.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.account, account));
    return rows.reduce((n, e) => n + e.creditKobo - e.debitKobo, 0);
  };
  const pay = (who: Who, id: string) =>
    who.agent.post(`/v1/jobs/${id}/balance/pay`).set(CLIENT_HEADER).send();
  const confirm = (who: Who, id: string) =>
    who.agent.post(`/v1/jobs/${id}/confirm`).set(CLIENT_HEADER).send();
  const complete = (who: Who, reference: string) =>
    who.agent
      .post(`/v1/payments/test/${reference}/complete`)
      .set(CLIENT_HEADER)
      .send({ outcome: 'success' })
      .expect(200);

  it('only the customer pays and confirms; the balance is held, then paid to the Pro less 10%', async () => {
    const { customer, pro, id } = await finishedJob();
    const stranger = await login(ctx);
    await pay(pro, id).expect(403);
    await pay(stranger, id).expect(404);
    await customer.agent.post(`/v1/jobs/${id}/balance/pay`).send().expect(403); // CSRF
    await confirm(customer, id).expect(409); // not paid yet

    const started = await pay(customer, id).expect(200);
    const [payment] = await ctx.db
      .select()
      .from(payments)
      .where(eq(payments.paystackReference, started.body.reference));
    expect(payment).toMatchObject({ type: 'BALANCE', amountKobo: 1_200_000, status: 'PENDING' });
    await complete(customer, started.body.reference);

    const [held] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(held!.status).toBe('BALANCE_HELD');
    const hours = (held!.balanceReleaseAt!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    expect(await sum(`escrow:job:${id}`)).toBe(1_200_000);
    expect(await sum(`pro:${pro.userId}`)).toBe(1_000_000); // only the deposit so far
    const chat = await customer.agent.get(`/v1/jobs/${id}/messages`).expect(200);
    expect(chat.body.work.releaseAt).toBeTruthy();
    expect(chat.body.messages.at(-1).body).toContain('GADMO holds it for 12 hours');
    await pay(customer, id).expect(409); // already paid

    await confirm(pro, id).expect(403);
    await confirm(stranger, id).expect(404);
    await confirm(customer, id).expect(200);
    const [done] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(done!.status).toBe('COMPLETED');
    expect(await sum(`escrow:job:${id}`)).toBe(0);
    // Deposit ₦10,000 + balance ₦12,000 − commission ₦2,500 (10% of the ₦25,000 quote).
    expect(await sum(`pro:${pro.userId}`)).toBe(1_950_000);
    const commission = await ctx.db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.account, 'gadmo:commission'), eq(ledgerEntries.jobId, id)));
    expect(commission.reduce((n, e) => n + e.creditKobo, 0)).toBe(250_000);
    await confirm(customer, id).expect(409); // paid once only
  });

  it('pays the Pro automatically after 12 hours, but never a job under dispute', async () => {
    const balances = ctx.app.get(BalanceService);
    const a = await finishedJob();
    const b = await finishedJob();
    for (const { customer, id } of [a, b]) {
      const started = await pay(customer, id).expect(200);
      await complete(customer, started.body.reference);
    }
    const past = new Date(Date.now() - 60_000);
    await ctx.db.update(jobs).set({ balanceReleaseAt: past }).where(eq(jobs.id, a.id));
    await ctx.db
      .update(jobs)
      .set({ balanceReleaseAt: past, status: 'DISPUTED' })
      .where(eq(jobs.id, b.id));

    await balances.tick();
    const [released] = await ctx.db.select().from(jobs).where(eq(jobs.id, a.id));
    const [disputed] = await ctx.db.select().from(jobs).where(eq(jobs.id, b.id));
    expect(released!.status).toBe('COMPLETED');
    expect(await sum(`pro:${a.pro.userId}`)).toBe(1_950_000);
    expect(disputed!.status).toBe('DISPUTED');
    expect(await sum(`escrow:job:${b.id}`)).toBe(1_200_000);
    expect(await sum(`pro:${b.pro.userId}`)).toBe(1_000_000);

    // A job not yet due stays held.
    const c = await finishedJob();
    const started = await pay(c.customer, c.id).expect(200);
    await complete(c.customer, started.body.reference);
    await balances.tick();
    const [stillHeld] = await ctx.db.select().from(jobs).where(eq(jobs.id, c.id));
    expect(stillHeld!.status).toBe('BALANCE_HELD');
  });

  it('nothing left to pay: held for the same 12 hours; commission comes from the Pro’s wallet', async () => {
    // ₦10,000 quote, ₦5,000 deposit, ₦5,000 inspection fee: no balance.
    const { customer, pro, id } = await finishedJob(1_000_000, 500_000, 500_000);
    const [held] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(held!.status).toBe('BALANCE_HELD');
    await pay(customer, id).expect(409);
    await confirm(customer, id).expect(200);
    // ₦5,000 deposit − ₦1,000 commission.
    expect(await sum(`pro:${pro.userId}`)).toBe(400_000);
  });
});

describe('public top-rated Pros', () => {
  it('lists verified Pros only, with a short name, skills and rating; no contact or location', async () => {
    const approved = await login(ctx, { role: 'pro' });
    const pending = await login(ctx, { role: 'pro' });
    await ctx.db
      .update(users)
      .set({ name: 'Zainab Top Rated' })
      .where(eq(users.id, approved.userId));
    for (const [p, status] of [
      [approved, 'APPROVED'],
      [pending, 'PENDING'],
    ] as const) {
      await ctx.db
        .insert(proProfiles)
        .values({
          userId: p.userId,
          verificationStatus: status,
          ratingAvg: 5,
          ratingCount: 999,
          latitude: 7.6,
          longitude: 5.2,
        })
        .onConflictDoUpdate({
          target: proProfiles.userId,
          set: { verificationStatus: status, ratingAvg: 5, ratingCount: 999 },
        });
      await ctx.db
        .insert(proCategories)
        .values({ proId: p.userId, categoryId: electricianId })
        .onConflictDoNothing();
    }
    const res = await request(ctx.app.getHttpServer()).get('/v1/pros/top').expect(200);
    const ids = res.body.pros.map((p: { id: string }) => p.id);
    expect(ids).toContain(approved.userId);
    expect(ids).not.toContain(pending.userId);
    const top = res.body.pros.find((p: { id: string }) => p.id === approved.userId);
    expect(top).toEqual({
      id: approved.userId,
      name: 'Zainab R.',
      ratingAvg: 5,
      ratingCount: 999,
      skills: [{ name: 'Electrician', slug: 'electrician' }],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/phone|latitude|\+234/);
  });
});

describe('staff: why a job reaches (or misses) Pros', () => {
  it('only staff can see it; each matching rule is shown per Pro', async () => {
    const customer = await login(ctx);
    const lat = -30 - Math.random() * 10; // far from every other test Pro
    const lng = -60 - Math.random() * 10;
    const created = await customer.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(
        newJob(electricianId, {
          type: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          latitude: lat,
          longitude: lng,
        }),
      )
      .expect(201);
    const id = created.body.job.id as string;

    const makePro = async (patch: Partial<typeof proProfiles.$inferInsert>) => {
      const p = await login(ctx, { role: 'pro' });
      await ctx.db
        .insert(proProfiles)
        .values({ userId: p.userId, ...patch })
        .onConflictDoUpdate({ target: proProfiles.userId, set: patch });
      await ctx.db
        .insert(proCategories)
        .values({ proId: p.userId, categoryId: electricianId })
        .onConflictDoNothing();
      return p;
    };
    const ready = await makePro({ latitude: lat, longitude: lng, verificationStatus: 'APPROVED' });
    const unverified = await makePro({
      latitude: lat,
      longitude: lng,
      verificationStatus: 'PENDING',
    });
    const farAway = await makePro({
      latitude: lat + 1,
      longitude: lng,
      verificationStatus: 'APPROVED',
    });
    const noArea = await makePro({ verificationStatus: 'APPROVED' });

    for (const who of [customer, ready]) {
      await who.agent.get(`/v1/admin/jobs/${id}/matching`).expect(403);
    }
    await request(ctx.server).get(`/v1/admin/jobs/${id}/matching`).expect(401);

    const staff = await login(ctx);
    await ctx.db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, staff.userId));
    const res = await staff.agent.get(`/v1/admin/jobs/${id}/matching`).expect(200);
    expect(res.body.job).toMatchObject({ id, serviceName: 'Electrician', type: 'SCHEDULED' });
    const byId = new Map(res.body.pros.map((p: { id: string }) => [p.id, p] as const)) as Map<
      string,
      { matches: boolean; checks: Record<string, boolean>; distanceKm: number }
    >;
    expect(byId.get(ready.userId)).toMatchObject({ matches: true, distanceKm: 0 });
    expect(byId.get(unverified.userId)).toMatchObject({
      matches: false,
      checks: { verified: false, withinDistance: true },
    });
    expect(byId.get(farAway.userId)!.checks).toMatchObject({
      verified: true,
      withinDistance: false,
    });
    expect(byId.get(farAway.userId)!.distanceKm).toBeGreaterThan(100);
    expect(byId.get(noArea.userId)!.checks).toMatchObject({
      serviceAreaSet: false,
      withinDistance: false,
    });
    // The matching agrees with what the customer sees.
    const seen = await customer.agent.get(`/v1/jobs/${id}/pros`).expect(200);
    expect(seen.body.pros.map((p: { id: string }) => p.id)).toEqual([ready.userId]);
    await staff.agent
      .get('/v1/admin/jobs/00000000-0000-4000-8000-000000000000/matching')
      .expect(404);
  });
});

describe('staff: overview, users and jobs', () => {
  async function staffMember(role: 'ADMIN' | 'SUPER_ADMIN' = 'ADMIN') {
    const s = await login(ctx);
    await ctx.db.update(users).set({ role }).where(eq(users.id, s.userId));
    return s;
  }

  it('only staff can see the overview, accounts and jobs, or change an account', async () => {
    const customer = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    for (const who of [customer, pro]) {
      await who.agent.get('/v1/admin/overview').expect(403);
      await who.agent.get('/v1/admin/users').expect(403);
      await who.agent.get(`/v1/admin/users/${customer.userId}`).expect(403);
      await who.agent.get('/v1/admin/jobs').expect(403);
      await who.agent
        .post(`/v1/admin/users/${customer.userId}/status`)
        .set(CLIENT_HEADER)
        .send({ status: 'BANNED', reason: 'testing access' })
        .expect(403);
    }
    await request(ctx.server).get('/v1/admin/users').expect(401);
  });

  it('staff find accounts by name or phone in any format, and see them in full', async () => {
    const reviewer = await staffMember();
    const pro = await login(ctx, { role: 'pro' });
    const name = `Zainab ${Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
    await pro.agent.patch('/v1/me').set(CLIENT_HEADER).send({ name }).expect(200);

    const byName = await reviewer.agent.get('/v1/admin/users').query({ q: name }).expect(200);
    expect(byName.body.users).toHaveLength(1);
    expect(byName.body.users[0]).toMatchObject({ id: pro.userId, role: 'PRO', status: 'ACTIVE' });
    const local = `${pro.phone.local.slice(0, 4)} ${pro.phone.local.slice(4, 7)} ${pro.phone.local.slice(7)}`;
    const byPhone = await reviewer.agent.get('/v1/admin/users').query({ q: local }).expect(200);
    expect(byPhone.body.users.map((u: { id: string }) => u.id)).toContain(pro.userId);
    const pros = await reviewer.agent.get('/v1/admin/users').query({ role: 'PRO' }).expect(200);
    expect(pros.body.users.every((u: { role: string }) => u.role === 'PRO')).toBe(true);
    await reviewer.agent.get('/v1/admin/users').query({ role: 'GOD' }).expect(400);
    await reviewer.agent.get('/v1/admin/users').query({ q: '%' }).expect(200);

    const detail = await reviewer.agent.get(`/v1/admin/users/${pro.userId}`).expect(200);
    expect(detail.body.user).toMatchObject({ name, phone: pro.phone.e164, role: 'PRO' });
    expect(detail.body.user.pro).toMatchObject({ verificationStatus: 'NOT_STARTED' });
    await reviewer.agent.get('/v1/admin/users/00000000-0000-4000-8000-000000000000').expect(404);

    const overview = await reviewer.agent.get('/v1/admin/overview').expect(200);
    expect(overview.body.overview.pros).toBeGreaterThanOrEqual(1);
    expect(overview.body.overview.customers).toBeGreaterThanOrEqual(1);
    const list = await reviewer.agent.get('/v1/admin/jobs').expect(200);
    expect(Array.isArray(list.body.jobs)).toBe(true);
    await reviewer.agent.get('/v1/admin/jobs').query({ status: 'NOPE' }).expect(400);
  });

  it('suspending signs the account out at once; reactivating lets it back in', async () => {
    const reviewer = await staffMember();
    const pro = await login(ctx, { role: 'pro' });
    const change = (status: string, reason = 'Repeated no-shows reported') =>
      reviewer.agent
        .post(`/v1/admin/users/${pro.userId}/status`)
        .set(CLIENT_HEADER)
        .send({ status, reason });

    await change('SUSPENDED', 'no').expect(400); // a reason is required
    await change('SUSPENDED').expect(200);
    await change('SUSPENDED').expect(409);
    await pro.agent.get('/v1/auth/me').expect(403);
    await pro.agent.post('/v1/auth/refresh').set(CLIENT_HEADER).expect(401);

    const [log] = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.target, `user:${pro.userId}`),
          eq(auditLogs.action, 'USER_STATUS_CHANGED'),
        ),
      );
    expect(log).toMatchObject({ actorId: reviewer.userId });
    expect(log!.metadata).toMatchObject({
      from: 'ACTIVE',
      to: 'SUSPENDED',
      reason: 'Repeated no-shows reported',
    });

    await change('ACTIVE', 'Cleared after review').expect(200);
    const again = await login(ctx, { role: 'pro', phone: pro.phone });
    await again.agent.get('/v1/auth/me').expect(200);
  });

  it('staff can let a locked-out person ask for a sign-in code again; nobody else can', async () => {
    const reviewer = await staffMember();
    const customer = await login(ctx);
    const ask = () =>
      request(ctx.server)
        .post('/v1/auth/otp/request')
        .set(CLIENT_HEADER)
        .send({ phone: customer.phone.local });
    for (let i = 0; i < 3; i++) await ask();
    const blocked = await ask().expect(429);
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);

    await customer.agent
      .post(`/v1/admin/users/${customer.userId}/reset-sign-in`)
      .set(CLIENT_HEADER)
      .expect(403);
    await reviewer.agent.post(`/v1/admin/users/${customer.userId}/reset-sign-in`).expect(403); // CSRF
    await reviewer.agent
      .post('/v1/admin/users/00000000-0000-4000-8000-000000000000/reset-sign-in')
      .set(CLIENT_HEADER)
      .expect(404);
    await reviewer.agent
      .post(`/v1/admin/users/${customer.userId}/reset-sign-in`)
      .set(CLIENT_HEADER)
      .expect(200);
    await ask().expect(202);
    const [log] = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.target, `user:${customer.userId}`),
          eq(auditLogs.action, 'SIGN_IN_LIMITS_RESET'),
        ),
      );
    expect(log!.actorId).toBe(reviewer.userId);
  });

  it('staff cannot change themselves, and only a super-admin can change staff', async () => {
    const a = await staffMember();
    const b = await staffMember();
    const boss = await staffMember('SUPER_ADMIN');
    const set = (who: typeof a, id: string) =>
      who.agent
        .post(`/v1/admin/users/${id}/status`)
        .set(CLIENT_HEADER)
        .send({ status: 'SUSPENDED', reason: 'Testing staff rules' });
    await set(a, a.userId).expect(403);
    await set(a, b.userId).expect(403);
    await set(boss, b.userId).expect(200);
    await a.agent
      .post(`/v1/admin/users/${a.userId}/status`)
      .send({ status: 'ACTIVE', reason: 'missing header' })
      .expect(403);
  });
});

describe('choosing a Pro: only the job’s customer, only eligible Pros', () => {
  it('nobody else can list Pros for a job or send it to one', async () => {
    const alice = await login(ctx);
    const created = await alice.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(
        newJob(electricianId, {
          type: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      )
      .expect(201);
    const id = created.body.job.id as string;
    const bob = await login(ctx);
    const pro = await login(ctx, { role: 'pro' });
    await bob.agent.get(`/v1/jobs/${id}/pros`).expect(404);
    await bob.agent
      .post(`/v1/jobs/${id}/requests`)
      .set(CLIENT_HEADER)
      .send({ proId: pro.userId })
      .expect(404);
    await pro.agent.get(`/v1/jobs/${id}/pros`).expect(403);
    await request(ctx.server).get(`/v1/jobs/${id}/pros`).expect(401);
    // An unverified Pro can't be chosen, even by id.
    await alice.agent
      .post(`/v1/jobs/${id}/requests`)
      .set(CLIENT_HEADER)
      .send({ proId: pro.userId })
      .expect(422);
    await alice.agent.post(`/v1/jobs/${id}/requests`).send({ proId: pro.userId }).expect(403); // CSRF
    await alice.agent
      .post(`/v1/jobs/${id}/requests`)
      .set(CLIENT_HEADER)
      .send({ proId: 'x' })
      .expect(400);
  });

  it('emergencies are not chosen by hand', async () => {
    const alice = await login(ctx);
    const created = await alice.agent
      .post('/v1/jobs')
      .set(CLIENT_HEADER)
      .send(newJob(electricianId, { latitude: 3 + Math.random(), longitude: 3 + Math.random() }))
      .expect(201);
    await alice.agent.get(`/v1/jobs/${created.body.job.id}/pros`).expect(409);
  });
});
