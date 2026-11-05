import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  categories,
  jobs,
  messages,
  privateFiles,
  proProfiles,
  users,
  verifications,
} from '../src/db/schema';
import { FIELD_CRYPTO } from '../src/infra/infra.module';
import type { FieldCrypto } from '../src/common/field-crypto';
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
      .send({ nin: '12345678901' })
      .expect(403);
  });

  it('a Pro uploads two photos and a NIN; it is stored encrypted and goes to review', async () => {
    const pro = await login(ctx, { role: 'pro' });
    const start = await pro.agent.get('/v1/pro/verification').expect(200);
    expect(start.body.verification).toMatchObject({
      status: 'NOT_STARTED',
      canSubmit: true,
      photos: { idDocument: false, selfie: false },
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
      .send({ nin: '12345678901' })
      .expect(422); // no ID photo yet
    await upload(pro.agent, 'id-document', jpeg(3000)).expect(204);
    await upload(pro.agent, 'id-document', jpeg(3100)).expect(204); // replaces the draft
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '1234567890' })
      .expect(400);

    const res = await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '1234 5678 901' })
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
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.verificationId === row!.id)).toBe(true);
    const id = files.find((f) => f.purpose === 'ID_DOCUMENT')!;
    expect(id.byteSize).toBe(3104);
    expect(crypto.decrypt(id.dataEncrypted).equals(jpeg(3100))).toBe(true);
    const [profile] = await ctx.db
      .select()
      .from(proProfiles)
      .where(eq(proProfiles.userId, pro.userId));
    expect(profile!.verificationStatus).toBe('PENDING');

    // While under review nothing can be changed.
    await upload(pro.agent, 'selfie', jpeg()).expect(409);
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '12345678901' })
      .expect(409);
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
    await pro.agent
      .post('/v1/pro/verification')
      .set(CLIENT_HEADER)
      .send({ nin: '12345678901' })
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
      photos: { idDocument: false, selfie: false },
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
    ] as const) {
      await pro.agent
        .put(`/v1/pro/verification/photos/${kind}`)
        .set(CLIENT_HEADER)
        .set('content-type', 'image/jpeg')
        .send(jpeg(fill))
        .expect(204);
    }
    await pro.agent.post('/v1/pro/verification').set(CLIENT_HEADER).send({ nin }).expect(200);
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
    });

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

  it('approving lets the Pro go online; rejecting takes them offline', async () => {
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
    await pro.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true }).expect(200);

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
      .query({ after: sent.body.message.createdAt })
      .expect(200);
    expect(after.body.messages.map((m: { body: string }) => m.body)).toEqual(['I can come at 3pm']);

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
    await customer.agent.get(`/v1/jobs/${id}/messages`).query({ after: 'yesterday' }).expect(400);
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
