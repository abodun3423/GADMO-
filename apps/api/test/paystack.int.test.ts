import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categories, jobs, ledgerEntries, payments } from '../src/db/schema';
import { PAYMENT_GATEWAY, PaystackGateway } from '../src/payments/gateway';
import { CLIENT_HEADER, createTestApp, login, type TestContext } from './helpers';

/** Paystack's API, faked at the HTTP level so the real PaystackGateway code runs. */
const SECRET = 'sk_test_fake_integration';
const paystack = {
  calls: [] as { url: string; body: unknown; auth: string | null }[],
  verify: new Map<string, { status: string; amount: number; currency: string }>(),
  transfers: new Map<string, string>(),
};
const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  paystack.calls.push({
    url,
    body: init?.body ? JSON.parse(String(init.body)) : null,
    auth: headers.get('authorization'),
  });
  if (url.includes('/bank?')) {
    return Response.json({
      status: true,
      data: [{ code: '058', name: 'Guaranty Trust Bank', active: true }],
    });
  }
  if (url.includes('/bank/resolve')) {
    return Response.json({ status: true, data: { account_name: 'BOBADE MERCY' } });
  }
  if (url.endsWith('/transferrecipient')) {
    return Response.json({ status: true, data: { recipient_code: 'RCP_fake123' } });
  }
  if (url.endsWith('/transfer')) {
    return Response.json({ status: true, data: { status: 'pending' } });
  }
  if (url.includes('/transfer/verify/')) {
    const ref = decodeURIComponent(url.split('/transfer/verify/')[1] ?? '');
    return Response.json({
      status: true,
      data: { status: paystack.transfers.get(ref) ?? 'pending' },
    });
  }
  if (url.endsWith('/transaction/initialize')) {
    return Response.json({
      status: true,
      data: { authorization_url: 'https://checkout.paystack.com/abc123' },
    });
  }
  const ref = decodeURIComponent(url.split('/transaction/verify/')[1] ?? '');
  const data = paystack.verify.get(ref) ?? { status: 'ongoing', amount: 0, currency: 'NGN' };
  return Response.json({ status: true, data });
}) as typeof fetch;

let ctx: TestContext;
let electricianId: string;

beforeAll(async () => {
  ctx = await createTestApp([
    { provide: PAYMENT_GATEWAY, useValue: new PaystackGateway(SECRET, fakeFetch) },
  ]);
  const rows = await ctx.db.select().from(categories);
  electricianId = rows.find((c) => c.slug === 'electrician')!.id;
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.redis.flushdb();
});

async function startPayment() {
  const customer = await login(ctx);
  const pro = await login(ctx, { role: 'pro' });
  const created = await customer.agent
    .post('/v1/jobs')
    .set(CLIENT_HEADER)
    .send({
      categoryId: electricianId,
      type: 'SCHEDULED',
      description: 'Sockets in the parlour are sparking',
      latitude: 1 + Math.random(),
      longitude: 1 + Math.random(),
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .expect(201);
  const id = created.body.job.id as string;
  await ctx.db
    .update(jobs)
    .set({ proId: pro.userId, status: 'ACCEPTED', inspectionFeeKobo: 300_000 })
    .where(eq(jobs.id, id));
  const res = await customer.agent
    .post(`/v1/jobs/${id}/inspection-fee/pay`)
    .set(CLIENT_HEADER)
    .expect(200);
  return { customer, id, ref: res.body.reference as string, url: res.body.authorizationUrl };
}

function webhook(body: object, secret = SECRET) {
  const raw = JSON.stringify(body);
  return request(ctx.server)
    .post('/v1/payments/paystack/webhook')
    .set('content-type', 'application/json')
    .set('x-paystack-signature', createHmac('sha512', secret).update(raw).digest('hex'))
    .send(raw);
}

describe('Paystack', () => {
  it('starts a Paystack checkout without sharing the customer’s phone or email', async () => {
    const { customer, ref, url } = await startPayment();
    expect(url).toBe('https://checkout.paystack.com/abc123');
    const init = paystack.calls.find((c) => c.url.endsWith('/initialize'))!;
    expect(init.auth).toBe(`Bearer ${SECRET}`);
    expect(init.body).toMatchObject({
      reference: ref,
      amount: 300_000,
      currency: 'NGN',
      email: `customer-${customer.userId}@pay.gadmo.ng`,
      callback_url: 'http://localhost:3000/pay/return',
    });
    expect(JSON.stringify(init.body)).not.toContain(customer.phone.local.slice(1));
  });

  it('a signed webhook is re-checked with Paystack before the payment counts', async () => {
    const { id, ref } = await startPayment();
    // Signed, but Paystack does not (yet) report success: nothing changes.
    await webhook({ event: 'charge.success', data: { reference: ref } }).expect(200);
    let [p] = await ctx.db.select().from(payments).where(eq(payments.paystackReference, ref));
    expect(p!.status).toBe('PENDING');

    paystack.verify.set(ref, { status: 'success', amount: 300_000, currency: 'NGN' });
    await webhook({ event: 'charge.success', data: { reference: ref } }).expect(200);
    await webhook({ event: 'charge.success', data: { reference: ref } }).expect(200); // replay
    [p] = await ctx.db.select().from(payments).where(eq(payments.paystackReference, ref));
    expect(p!.status).toBe('SUCCEEDED');
    const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(job!.status).toBe('INSPECTION_PAID');
  });

  it('refuses unsigned or forged webhooks, and never credits a different amount', async () => {
    const { id, ref, customer } = await startPayment();
    paystack.verify.set(ref, { status: 'success', amount: 300_000, currency: 'NGN' });
    await request(ctx.server)
      .post('/v1/payments/paystack/webhook')
      .send({ event: 'charge.success', data: { reference: ref } })
      .expect(401);
    await webhook(
      { event: 'charge.success', data: { reference: ref } },
      'sk_test_fake_wrong',
    ).expect(401);
    let [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(job!.status).toBe('ACCEPTED');

    const other = await startPayment();
    paystack.verify.set(other.ref, { status: 'success', amount: 100, currency: 'NGN' });
    const checked = await other.customer.agent
      .post(`/v1/payments/${other.ref}/check`)
      .set(CLIENT_HEADER)
      .expect(200);
    expect(checked.body.payment.status).toBe('FAILED');
    [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, other.id));
    expect(job!.status).toBe('ACCEPTED');
    // The test checkout is off when Paystack is in use.
    await customer.agent.get(`/v1/payments/test/${ref}`).expect(404);
  });
});

describe('Paystack transfers (wallet withdrawals)', () => {
  it('pays out through Paystack and settles when its signed webhook arrives', async () => {
    const pro = await login(ctx, { role: 'pro' });
    const txnId = crypto.randomUUID();
    await ctx.db.insert(ledgerEntries).values([
      { txnId, account: 'test:source', debitKobo: 500_000, description: 'test' },
      { txnId, account: `pro:${pro.userId}`, creditKobo: 500_000, description: 'test' },
    ]);
    const bank = await pro.agent
      .put('/v1/wallet/bank-account')
      .set(CLIENT_HEADER)
      .send({ bankCode: '058', accountNumber: '0123456789' })
      .expect(200);
    expect(bank.body.bankAccount.accountName).toBe('BOBADE MERCY');
    const recipient = paystack.calls.find((c) => c.url.endsWith('/transferrecipient'))!;
    expect(recipient.body).toMatchObject({
      type: 'nuban',
      account_number: '0123456789',
      bank_code: '058',
    });

    const sent = await pro.agent
      .post('/v1/wallet/withdrawals')
      .set(CLIENT_HEADER)
      .send({ amountKobo: 300_000 })
      .expect(200);
    expect(sent.body.withdrawal.status).toBe('PROCESSING');
    const transfer = paystack.calls.filter((c) => c.url.endsWith('/transfer')).at(-1)!;
    const reference = (transfer.body as { reference: string }).reference;
    expect(transfer.body).toMatchObject({
      amount: 300_000,
      recipient: 'RCP_fake123',
      currency: 'NGN',
    });

    paystack.transfers.set(reference, 'success');
    await webhook({ event: 'transfer.success', data: { reference } }).expect(200);
    const after = await pro.agent.get('/v1/wallet').expect(200);
    expect(after.body.wallet.withdrawals[0].status).toBe('PAID');
    expect(after.body.wallet.balanceKobo).toBe(200_000);
  });
});
