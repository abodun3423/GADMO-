import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { refreshTokens, users } from '../src/db/schema';
import { CLIENT_HEADER, createTestApp, login, randomPhone, type TestContext } from './helpers';

/** Staff sign in separately: email + password, then a code to their phone; 12-hour sessions. */
let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.redis.flushdb();
});

async function staffAccount(password = 'a long staff password') {
  const phone = randomPhone();
  const email = `staff-${phone.local}@gadmo.test`;
  const [row] = await ctx.db
    .insert(users)
    .values({ phone: phone.e164, role: 'ADMIN', email, passwordHash: await hashPassword(password) })
    .returning({ id: users.id });
  return { id: row!.id, phone, email, password };
}

async function signInStaff(s: Awaited<ReturnType<typeof staffAccount>>) {
  const agent = request.agent(ctx.server);
  await agent
    .post('/v1/auth/staff/login')
    .set(CLIENT_HEADER)
    .send({ email: s.email.toUpperCase(), password: s.password })
    .expect(202);
  const code = ctx.sms.lastCode.get(s.phone.e164)!;
  const res = await agent
    .post('/v1/auth/staff/verify')
    .set(CLIENT_HEADER)
    .send({ email: s.email, code })
    .expect(200);
  return { agent, res };
}

describe('staff sign-in', () => {
  it('password then phone code gives a staff session that opens the review pages', async () => {
    const s = await staffAccount();
    const { agent, res } = await signInStaff(s);
    expect(res.body.user).toMatchObject({ id: s.id, role: 'ADMIN' });
    await agent.get('/v1/admin/verifications').expect(200);
    const me = await agent.get('/v1/auth/me').expect(200);
    expect(me.body.user.role).toBe('ADMIN');
  });

  it('staff sessions end after 12 hours and do not slide when renewed', async () => {
    const s = await staffAccount();
    const { agent, res } = await signInStaff(s);
    const cookie = String(res.headers['set-cookie']).match(/gadmo_rt=[^;]+;[^,]*Max-Age=(\d+)/);
    expect(Number(cookie![1])).toBeLessThanOrEqual(12 * 3600);
    expect(Number(cookie![1])).toBeGreaterThan(12 * 3600 - 60);

    const [first] = await ctx.db.select().from(refreshTokens).where(eq(refreshTokens.userId, s.id));
    expect(first!.kind).toBe('staff');
    await agent.post('/v1/auth/refresh').set(CLIENT_HEADER).expect(200);
    const rows = await ctx.db.select().from(refreshTokens).where(eq(refreshTokens.userId, s.id));
    const next = rows.find((r) => r.id !== first!.id)!;
    expect(next.kind).toBe('staff');
    expect(next.expiresAt.getTime()).toBe(first!.expiresAt.getTime());
  });

  it('a wrong password and an unknown email get the same answer; no code is sent', async () => {
    const s = await staffAccount();
    const wrong = await request(ctx.server)
      .post('/v1/auth/staff/login')
      .set(CLIENT_HEADER)
      .send({ email: s.email, password: 'not it at all' })
      .expect(401);
    const unknown = await request(ctx.server)
      .post('/v1/auth/staff/login')
      .set(CLIENT_HEADER)
      .send({ email: 'nobody@gadmo.test', password: 'not it at all' })
      .expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(ctx.sms.lastCode.get(s.phone.e164)).toBeUndefined();
  });

  it('customers and Pros cannot use the staff sign-in, even with an email and password', async () => {
    for (const role of ['CUSTOMER', 'PRO'] as const) {
      const phone = randomPhone();
      const email = `${role.toLowerCase()}-${phone.local}@gadmo.test`;
      await ctx.db.insert(users).values({
        phone: phone.e164,
        role,
        email,
        passwordHash: await hashPassword('a long enough password'),
      });
      await request(ctx.server)
        .post('/v1/auth/staff/login')
        .set(CLIENT_HEADER)
        .send({ email, password: 'a long enough password' })
        .expect(401);
    }
  });

  it('the phone code only works right after a correct password', async () => {
    const s = await staffAccount();
    // A code obtained through the customer sign-in can't be used here.
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: s.phone.local })
      .expect(202);
    const code = ctx.sms.lastCode.get(s.phone.e164)!;
    await request(ctx.server)
      .post('/v1/auth/staff/verify')
      .set(CLIENT_HEADER)
      .send({ email: s.email, code })
      .expect(401);
  });

  it('staff cannot sign in through the customer and Pro sign-in', async () => {
    const s = await staffAccount();
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: s.phone.local })
      .expect(202);
    const res = await request(ctx.server)
      .post('/v1/auth/otp/verify')
      .set(CLIENT_HEADER)
      .send({ phone: s.phone.local, code: ctx.sms.lastCode.get(s.phone.e164) })
      .expect(403);
    expect(res.body.message).toContain('staff page');
  });

  it('password guessing is rate limited and needs the CSRF header', async () => {
    const s = await staffAccount();
    await request(ctx.server)
      .post('/v1/auth/staff/login')
      .send({ email: s.email, password: s.password })
      .expect(403);
    for (let i = 0; i < 10; i++) {
      await request(ctx.server)
        .post('/v1/auth/staff/login')
        .set(CLIENT_HEADER)
        .send({ email: s.email, password: `guess ${i}` })
        .expect(401);
    }
    await request(ctx.server)
      .post('/v1/auth/staff/login')
      .set(CLIENT_HEADER)
      .send({ email: s.email, password: s.password })
      .expect(429);
  });

  it('staff change their own password; customers cannot use the route', async () => {
    const s = await staffAccount();
    const { agent } = await signInStaff(s);
    const change = (body: Record<string, string>) =>
      agent.post('/v1/auth/staff/password').set(CLIENT_HEADER).send(body);
    await change({ currentPassword: 'wrong one', newPassword: 'a brand new long password' }).expect(
      401,
    );
    await change({ currentPassword: s.password, newPassword: 'short' }).expect(400);
    await change({ currentPassword: s.password, newPassword: 'a brand new long password' }).expect(
      204,
    );
    await ctx.redis.flushdb();
    await request(ctx.server)
      .post('/v1/auth/staff/login')
      .set(CLIENT_HEADER)
      .send({ email: s.email, password: s.password })
      .expect(401);
    await request(ctx.server)
      .post('/v1/auth/staff/login')
      .set(CLIENT_HEADER)
      .send({ email: s.email, password: 'a brand new long password' })
      .expect(202);

    const customer = await login(ctx);
    await customer.agent
      .post('/v1/auth/staff/password')
      .set(CLIENT_HEADER)
      .send({ currentPassword: 'x', newPassword: 'a brand new long password' })
      .expect(403);
  });

  it('the password step does not rely on Redis timing, and each one signs in once', async () => {
    const s = await staffAccount();
    const agent = request.agent(ctx.server);
    const login = await agent
      .post('/v1/auth/staff/login')
      .set(CLIENT_HEADER)
      .send({ email: s.email, password: s.password })
      .expect(202);
    // The proof of the password is a signed cookie, not a Redis key that can expire early.
    expect(await ctx.redis.keys('staff-challenge*')).toEqual([]);
    const challenge = String(login.headers['set-cookie']).match(/gadmo_staff_challenge=[^;]+/)![0];
    expect(String(login.headers['set-cookie'])).toMatch(/HttpOnly/i);

    await agent
      .post('/v1/auth/staff/verify')
      .set(CLIENT_HEADER)
      .send({ email: s.email, code: ctx.sms.lastCode.get(s.phone.e164) })
      .expect(200);

    // Replaying the same challenge with a fresh code is refused.
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: s.phone.local })
      .expect(202);
    await request(ctx.server)
      .post('/v1/auth/staff/verify')
      .set(CLIENT_HEADER)
      .set('cookie', challenge)
      .send({ email: s.email, code: ctx.sms.lastCode.get(s.phone.e164) })
      .expect(401);
  });

  it('a challenge for one staff member cannot be used for another', async () => {
    const a = await staffAccount();
    const b = await staffAccount();
    const login = await request(ctx.server)
      .post('/v1/auth/staff/login')
      .set(CLIENT_HEADER)
      .send({ email: a.email, password: a.password })
      .expect(202);
    const challenge = String(login.headers['set-cookie']).match(/gadmo_staff_challenge=[^;]+/)![0];
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: b.phone.local })
      .expect(202);
    await request(ctx.server)
      .post('/v1/auth/staff/verify')
      .set(CLIENT_HEADER)
      .set('cookie', challenge)
      .send({ email: b.email, code: ctx.sms.lastCode.get(b.phone.e164) })
      .expect(401);
  });
});
