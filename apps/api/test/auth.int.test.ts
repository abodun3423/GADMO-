import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema';
import { CLIENT_HEADER, createTestApp, login, randomPhone, type TestContext } from './helpers';

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

const cookieHeader = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : [];
};

describe('health', () => {
  it('reports ok when Postgres and Redis are up', async () => {
    await request(ctx.server).get('/health').expect(200, { status: 'ok' });
  });

  it('sends security headers', async () => {
    const res = await request(ctx.server).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

describe('phone OTP login', () => {
  it('signs up a new customer and sets httpOnly cookies', async () => {
    const phone = randomPhone();
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local })
      .expect(202);
    const code = ctx.sms.lastCode.get(phone.e164)!;
    const res = await request(ctx.server)
      .post('/v1/auth/otp/verify')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local, code })
      .expect(200);

    expect(res.body.user).toMatchObject({ role: 'CUSTOMER', isNew: true });
    const cookies = cookieHeader(res);
    expect(cookies.find((c) => c.startsWith('gadmo_at='))).toMatch(/HttpOnly/);
    expect(cookies.find((c) => c.startsWith('gadmo_rt='))).toMatch(
      /HttpOnly.*SameSite=Strict|SameSite=Strict.*HttpOnly/,
    );
    expect(cookies.find((c) => c.startsWith('gadmo_rt='))).toContain('Path=/v1/auth');
    // Tokens never appear in the response body.
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ/);
  });

  it('creates a Pro profile when signing up as a Pro', async () => {
    const { agent } = await login(ctx, { role: 'pro' });
    const me = await agent.get('/v1/auth/me').expect(200);
    expect(me.body.user.role).toBe('PRO');
  });

  it('rejects an attempt to sign up as admin', async () => {
    const phone = randomPhone();
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local });
    const code = ctx.sms.lastCode.get(phone.e164)!;
    await request(ctx.server)
      .post('/v1/auth/otp/verify')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local, code, role: 'admin' })
      .expect(400);
  });

  it('rejects a wrong code and an invalid phone', async () => {
    const phone = randomPhone();
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local });
    const wrong = ctx.sms.lastCode.get(phone.e164) === '000000' ? '111111' : '000000';
    await request(ctx.server)
      .post('/v1/auth/otp/verify')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local, code: wrong })
      .expect(401);
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: '12345' })
      .expect(400);
  });

  it('a code works only once', async () => {
    const phone = randomPhone();
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local });
    const code = ctx.sms.lastCode.get(phone.e164)!;
    const body = { phone: phone.local, code };
    await request(ctx.server).post('/v1/auth/otp/verify').set(CLIENT_HEADER).send(body).expect(200);
    await request(ctx.server).post('/v1/auth/otp/verify').set(CLIENT_HEADER).send(body).expect(401);
  });

  it('destroys the code after 5 wrong guesses, even if the 6th is right', async () => {
    const phone = randomPhone();
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local });
    const code = ctx.sms.lastCode.get(phone.e164)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      await request(ctx.server)
        .post('/v1/auth/otp/verify')
        .set(CLIENT_HEADER)
        .send({ phone: phone.local, code: wrong })
        .expect(401);
    }
    // The 5th wrong guess uses up the code, and the person is told to ask for a new one.
    const locked = await request(ctx.server)
      .post('/v1/auth/otp/verify')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local, code: wrong })
      .expect(429);
    expect(locked.body.message).toContain('Ask for a new code');
    await request(ctx.server)
      .post('/v1/auth/otp/verify')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local, code })
      .expect(429);
  });

  it('a new code works again after the code was locked', async () => {
    const phone = randomPhone();
    const send = () =>
      request(ctx.server)
        .post('/v1/auth/otp/request')
        .set(CLIENT_HEADER)
        .send({ phone: phone.local });
    await send();
    const code = ctx.sms.lastCode.get(phone.e164)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await request(ctx.server)
        .post('/v1/auth/otp/verify')
        .set(CLIENT_HEADER)
        .send({ phone: phone.local, code: wrong });
    }
    await send();
    await request(ctx.server)
      .post('/v1/auth/otp/verify')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local, code: ctx.sms.lastCode.get(phone.e164)! })
      .expect(200);
  });

  it('only the newest code works after a code is sent again', async () => {
    const phone = randomPhone();
    const send = () =>
      request(ctx.server)
        .post('/v1/auth/otp/request')
        .set(CLIENT_HEADER)
        .send({ phone: phone.local });
    await send();
    const first = ctx.sms.lastCode.get(phone.e164)!;
    await send();
    const second = ctx.sms.lastCode.get(phone.e164)!;
    if (first !== second) {
      await request(ctx.server)
        .post('/v1/auth/otp/verify')
        .set(CLIENT_HEADER)
        .send({ phone: phone.local, code: first })
        .expect(401);
    }
    await request(ctx.server)
      .post('/v1/auth/otp/verify')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local, code: second })
      .expect(200);
  });

  it('rate-limits code requests per phone (3 per 10 minutes)', async () => {
    const phone = randomPhone();
    for (let i = 0; i < 3; i++) {
      await request(ctx.server)
        .post('/v1/auth/otp/request')
        .set(CLIENT_HEADER)
        .send({ phone: phone.local })
        .expect(202);
    }
    const res = await request(ctx.server)
      .post('/v1/auth/otp/request')
      .set(CLIENT_HEADER)
      .send({ phone: phone.local })
      .expect(429);
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('blocks state-changing requests without the client header (CSRF)', async () => {
    await request(ctx.server)
      .post('/v1/auth/otp/request')
      .send({ phone: randomPhone().local })
      .expect(403);
  });

  it('only allows the web app origin for credentialed CORS', async () => {
    const res = await request(ctx.server)
      .options('/v1/auth/otp/request')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});

describe('sessions', () => {
  it('requires a valid access token', async () => {
    await request(ctx.server).get('/v1/auth/me').expect(401);
    await request(ctx.server)
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);
  });

  it('/auth/me returns only the caller’s own account, including their phone', async () => {
    const { agent, phone } = await login(ctx);
    const res = await agent.get('/v1/auth/me').expect(200);
    expect(res.body.user.phone).toBe(phone.e164);
  });

  it('rotates the refresh token and revokes the family if an old token is replayed', async () => {
    const { agent } = await login(ctx);
    const first = await agent.post('/v1/auth/refresh').set(CLIENT_HEADER).expect(200);
    const firstToken = cookieHeader(first)
      .find((c) => c.startsWith('gadmo_rt='))!
      .split(';')[0]!;

    await agent.post('/v1/auth/refresh').set(CLIENT_HEADER).expect(200); // rotates again

    // An attacker replays the stolen, already-used token…
    await request(ctx.server)
      .post('/v1/auth/refresh')
      .set(CLIENT_HEADER)
      .set('Cookie', firstToken)
      .expect(401);
    // …and the legitimate session is revoked too, forcing a fresh login.
    await agent.post('/v1/auth/refresh').set(CLIENT_HEADER).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const { agent } = await login(ctx);
    await agent.post('/v1/auth/logout').set(CLIENT_HEADER).expect(204);
    await agent.post('/v1/auth/refresh').set(CLIENT_HEADER).expect(401);
  });

  it('a banned user is locked out immediately, even with a valid token', async () => {
    const { agent, userId } = await login(ctx);
    await agent.get('/v1/auth/me').expect(200);
    await ctx.db.update(users).set({ status: 'BANNED' }).where(eq(users.id, userId));
    await agent.get('/v1/auth/me').expect(403);
    await agent.post('/v1/auth/refresh').set(CLIENT_HEADER).expect(401);
  });
});
