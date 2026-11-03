import { eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categories, jobs, proProfiles } from '../src/db/schema';
import { CLIENT_HEADER, createTestApp, login, type TestContext } from './helpers';

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
    expect(res.body.user).toEqual({
      id: alice.userId,
      phone: alice.phone.e164,
      name: null,
      role: 'CUSTOMER',
    });
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
    const near = await postJob(customer);
    const far = await postJob(customer, LAGOS);
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
    const taken = await postJob(customer);
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
    for (const hidden of [far, otherSkill, taken, past]) expect(ids).not.toContain(hidden);

    const job = res.body.jobs.find((j: { id: string }) => j.id === near);
    expect(job.distanceKm).toBeGreaterThanOrEqual(0.5);
    expect(job.distanceKm).toBeLessThanOrEqual(2);
    // No identity, coordinates or address before a Pro is assigned.
    for (const key of ['customerId', 'latitude', 'longitude', 'addressEncrypted', 'proId']) {
      expect(job[key]).toBeUndefined();
    }
  });
});
