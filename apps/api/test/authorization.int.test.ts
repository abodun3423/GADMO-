import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categories, jobs } from '../src/db/schema';
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
  cleanerId = rows.find((c) => c.slug === 'cleaner')!.id;
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
