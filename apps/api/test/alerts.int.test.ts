import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PUSH_SENDER, type PushSender, type PushTarget } from '../src/alerts/push';
import { categories, proProfiles, pushSubscriptions } from '../src/db/schema';
import { CLIENT_HEADER, createTestApp, login, type TestContext } from './helpers';

/** Records pushes instead of sending them; endpoints containing "gone" act unsubscribed. */
class FakePush implements PushSender {
  readonly publicKey = 'BTestPublicKey';
  readonly sent: { endpoint: string; alert: { title: string; body: string; url: string } }[] = [];
  async send(target: PushTarget, payload: string) {
    if (target.endpoint.includes('gone')) return 'gone' as const;
    this.sent.push({ endpoint: target.endpoint, alert: JSON.parse(payload) });
    return 'ok' as const;
  }
}

const push = new FakePush();
let ctx: TestContext;
let electricianId: string;

beforeAll(async () => {
  ctx = await createTestApp([{ provide: PUSH_SENDER, useValue: push }]);
  const rows = await ctx.db.select().from(categories);
  electricianId = rows.find((c) => c.slug === 'electrician')!.id;
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.redis.flushdb();
});

type Agent = Awaited<ReturnType<typeof login>>;
const endpoint = (name: string) =>
  `https://push.example.com/${name}-${Math.random().toString(36).slice(2)}`;
const subscribe = (who: Agent, url: string) =>
  who.agent
    .post('/v1/push/subscriptions')
    .set(CLIENT_HEADER)
    .send({ endpoint: url, keys: { p256dh: 'BKey_-abc', auth: 'auth-123' } });

/** Alerts are sent in the background; wait for them. */
async function eventually<T>(read: () => T, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const v = read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return read();
}
const pushesTo = (url: string) => push.sent.filter((p) => p.endpoint === url).map((p) => p.alert);
/** Alert texts (not login codes) sent to this phone. */
const smsTo = (e164: string) =>
  ctx.sms.sent.filter((m) => m.to === e164 && m.text.startsWith('GADMO:')).map((m) => m.text);

describe('alert subscriptions', () => {
  it('only signed-in users subscribe, only https push services, and only their own', async () => {
    await request(ctx.server).get('/v1/push/key').expect(401);
    const alice = await login(ctx);
    expect((await alice.agent.get('/v1/push/key').expect(200)).body.publicKey).toBe(
      'BTestPublicKey',
    );
    const url = endpoint('alice');
    await alice.agent
      .post('/v1/push/subscriptions')
      .send({ endpoint: url, keys: { p256dh: 'a', auth: 'b' } })
      .expect(403); // CSRF
    await alice.agent
      .post('/v1/push/subscriptions')
      .set(CLIENT_HEADER)
      .send({ endpoint: 'http://push.example.com/x', keys: { p256dh: 'a', auth: 'b' } })
      .expect(400);
    await alice.agent
      .post('/v1/push/subscriptions')
      .set(CLIENT_HEADER)
      .send({ endpoint: url, keys: { p256dh: 'a', auth: 'b' }, userId: 'x' })
      .expect(400);
    await subscribe(alice, url).expect(200);

    // The same browser signing in as someone else moves the subscription.
    const bob = await login(ctx);
    await bob.agent
      .delete('/v1/push/subscriptions')
      .set(CLIENT_HEADER)
      .send({ endpoint: url })
      .expect(200);
    let [row] = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, url));
    expect(row!.userId).toBe(alice.userId); // Bob can't remove Alice's
    await subscribe(bob, url).expect(200);
    [row] = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, url));
    expect(row!.userId).toBe(bob.userId);
    await bob.agent
      .delete('/v1/push/subscriptions')
      .set(CLIENT_HEADER)
      .send({ endpoint: url })
      .expect(200);
    expect(
      await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, url)),
    ).toHaveLength(0);
  });
});

describe('alerts along a job', () => {
  it('emergency offer → Pro (push + SMS); accept → customer (push + SMS); chat → push, once a minute', async () => {
    const at = { latitude: -10 - Math.random() * 5, longitude: 20 + Math.random() * 5 };
    const pro = await login(ctx, { role: 'pro' });
    await pro.agent
      .put('/v1/pro/profile')
      .set(CLIENT_HEADER)
      .send({ categoryIds: [electricianId], bio: '', ...at, serviceRadiusKm: 10 })
      .expect(200);
    await ctx.db
      .update(proProfiles)
      .set({ verificationStatus: 'APPROVED' })
      .where(eq(proProfiles.userId, pro.userId));
    await pro.agent.post('/v1/pro/online').set(CLIENT_HEADER).send({ online: true }).expect(200);
    const proUrl = endpoint('pro');
    await subscribe(pro, proUrl).expect(200);
    await subscribe(pro, endpoint('gone')).expect(200); // an old browser

    const customer = await login(ctx);
    const customerUrl = endpoint('customer');
    await subscribe(customer, customerUrl).expect(200);
    const job = (
      await customer.agent
        .post('/v1/jobs')
        .set(CLIENT_HEADER)
        .send({
          categoryId: electricianId,
          type: 'EMERGENCY',
          description: 'Sparks from the socket in the kitchen',
          ...at,
        })
        .expect(201)
    ).body.job as { id: string };

    const [offerAlert] = await eventually(
      () => pushesTo(proUrl),
      (a) => a.length > 0,
    );
    expect(offerAlert).toMatchObject({ title: 'Emergency request near you', url: '/pro' });
    expect(offerAlert!.body).toContain('Electrician');
    expect(
      (
        await eventually(
          () => smsTo(pro.phone.e164),
          (m) => m.length > 0,
        )
      )[0],
    ).toMatch(/^GADMO: Electrician: .*Accept within 2 minutes\. http:\/\/localhost:3000\/pro$/);
    // The browser that unsubscribed is forgotten.
    const left = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, pro.userId));
    expect(left.map((s) => s.endpoint)).toEqual([proUrl]);

    const offers = (await pro.agent.get('/v1/pro/offers').expect(200)).body.offers;
    await pro.agent.post(`/v1/pro/offers/${offers[0].id}/accept`).set(CLIENT_HEADER).expect(200);
    const [accepted] = await eventually(
      () => pushesTo(customerUrl),
      (a) => a.length > 0,
    );
    expect(accepted).toMatchObject({
      title: 'A Pro accepted your request',
      url: `/jobs/${job.id}`,
    });
    expect(
      (
        await eventually(
          () => smsTo(customer.phone.e164),
          (m) => m.length > 0,
        )
      )[0],
    ).toContain('accepted your Electrician request');

    for (const body of ['Hello, I am coming. Call me 08031234567', 'Second message']) {
      await pro.agent
        .post(`/v1/jobs/${job.id}/messages`)
        .set(CLIENT_HEADER)
        .send({ body })
        .expect(201);
    }
    const all = await eventually(
      () => pushesTo(customerUrl),
      (a) => a.length >= 2,
    );
    await new Promise((r) => setTimeout(r, 200));
    const chat = pushesTo(customerUrl).filter((a) => a.title === 'New message from your Pro');
    expect(chat).toHaveLength(1);
    expect(chat[0]!.body).toContain('Hello, I am coming');
    expect(chat[0]!.body).not.toContain('08031234567'); // hidden, as in the chat
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Chat messages never go by SMS.
    expect(smsTo(customer.phone.e164)).toHaveLength(1);
  });
});
