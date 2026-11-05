import { randomUUID } from 'node:crypto';
import { eq, like, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bankAccounts, ledgerEntries, users } from '../src/db/schema';
import { CLIENT_HEADER, createTestApp, login, type TestContext } from './helpers';

/** Wallets: balances from the ledger, bank accounts, and withdrawals (test gateway). */
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

type Who = Awaited<ReturnType<typeof login>>;

/** Puts money in a wallet the way an arrival code does (balanced entries). */
async function credit(account: string, kobo: number) {
  const txnId = randomUUID();
  await ctx.db.insert(ledgerEntries).values([
    { txnId, account: 'test:source', debitKobo: kobo, description: 'test' },
    { txnId, account, creditKobo: kobo, description: 'Inspection fee for arriving' },
  ]);
}
const wallet = (who: Who) =>
  who.agent
    .get('/v1/wallet')
    .expect(200)
    .then((r) => r.body.wallet);
const setBank = (who: Who, body: object) =>
  who.agent.put('/v1/wallet/bank-account').set(CLIENT_HEADER).send(body);
const withdraw = (who: Who, amountKobo: number) =>
  who.agent.post('/v1/wallet/withdrawals').set(CLIENT_HEADER).send({ amountKobo });

describe('wallets', () => {
  it('each person sees only their own wallet; staff use the staff pages', async () => {
    await request(ctx.server).get('/v1/wallet').expect(401);
    const pro = await login(ctx, { role: 'pro' });
    const other = await login(ctx, { role: 'pro' });
    await credit(`pro:${pro.userId}`, 300_000);
    expect(await wallet(pro)).toMatchObject({
      balanceKobo: 300_000,
      minWithdrawalKobo: 100_000,
      bankAccount: null,
    });
    expect((await wallet(pro)).entries[0]).toMatchObject({
      description: 'Inspection fee for arriving',
      creditKobo: 300_000,
    });
    expect((await wallet(other)).balanceKobo).toBe(0);
    const customer = await login(ctx);
    await credit(`refund-due:customer:${customer.userId}`, 150_000);
    expect((await wallet(customer)).balanceKobo).toBe(150_000);

    const staff = await login(ctx);
    await ctx.db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, staff.userId));
    await staff.agent.get('/v1/wallet').expect(403);
    await pro.agent.get('/v1/admin/withdrawals').expect(403);
    await staff.agent.get('/v1/admin/withdrawals').expect(200);
  });

  it('a bank account is checked with the bank and stored encrypted', async () => {
    const pro = await login(ctx, { role: 'pro' });
    const banks = (await pro.agent.get('/v1/wallet/banks').expect(200)).body.banks;
    expect(banks).toContainEqual({ code: '058', name: 'Guaranty Trust Bank' });
    await setBank(pro, { bankCode: '058', accountNumber: '12345' }).expect(400);
    await setBank(pro, { bankCode: '058', accountNumber: '0123456789', extra: 1 }).expect(400);
    await setBank(pro, { bankCode: '123', accountNumber: '0123456789' }).expect(422);
    await setBank(pro, { bankCode: '058', accountNumber: '0001234567' }).expect(422);
    await pro.agent
      .put('/v1/wallet/bank-account')
      .send({ bankCode: '058', accountNumber: '0123456789' })
      .expect(403); // CSRF
    const saved = await setBank(pro, { bankCode: '058', accountNumber: '0123 456 789' }).expect(
      200,
    );
    expect(saved.body.bankAccount).toEqual({
      bankName: 'Guaranty Trust Bank',
      last4: '6789',
      accountName: 'TEST ACCOUNT HOLDER',
    });
    expect(JSON.stringify(saved.body)).not.toContain('0123456789');
    const [row] = await ctx.db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, pro.userId));
    expect(row!.accountNumberEncrypted).not.toContain('0123456789');
    expect((await wallet(pro)).bankAccount).toMatchObject({ last4: '6789' });
  });

  it('withdrawals: ₦1,000 minimum, never more than the balance, ledger balanced', async () => {
    const pro = await login(ctx, { role: 'pro' });
    await credit(`pro:${pro.userId}`, 500_000);
    await withdraw(pro, 200_000).expect(409); // no bank account yet
    await setBank(pro, { bankCode: '044', accountNumber: '0123456789' }).expect(200);
    await withdraw(pro, 99_900).expect(400);
    await withdraw(pro, 150_050).expect(400); // whole naira
    await withdraw(pro, 600_000).expect(409);

    const done = await withdraw(pro, 200_000).expect(200);
    expect(done.body.withdrawal).toMatchObject({
      amountKobo: 200_000,
      status: 'PAID',
      destination: 'Access Bank ••••6789',
    });
    const after = await wallet(pro);
    expect(after.balanceKobo).toBe(300_000);
    expect(after.withdrawals[0]).toMatchObject({ status: 'PAID', amountKobo: 200_000 });
    const [transit] = await ctx.db
      .select({ net: sql<string>`coalesce(sum(credit_kobo - debit_kobo), 0)` })
      .from(ledgerEntries)
      .where(like(ledgerEntries.account, 'withdrawals:in-transit'));
    expect(Number(transit!.net)).toBe(0);
  });

  it('a failed transfer puts the money back in the wallet', async () => {
    const customer = await login(ctx);
    await credit(`refund-due:customer:${customer.userId}`, 250_000);
    await setBank(customer, { bankCode: '057', accountNumber: '9991234567' }).expect(200);
    const res = await withdraw(customer, 250_000).expect(200);
    expect(res.body.withdrawal.status).toBe('FAILED');
    const after = await wallet(customer);
    expect(after.balanceKobo).toBe(250_000);
    expect(after.entries[0].description).toContain('failed: money returned');
  });

  it('two withdrawals at once can’t spend the same money; staff can pause withdrawals', async () => {
    const pro = await login(ctx, { role: 'pro' });
    await credit(`pro:${pro.userId}`, 300_000);
    await setBank(pro, { bankCode: '011', accountNumber: '0123456780' }).expect(200);
    const results = await Promise.all([withdraw(pro, 200_000), withdraw(pro, 200_000)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await wallet(pro)).balanceKobo).toBe(100_000);

    const staff = await login(ctx);
    await ctx.db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, staff.userId));
    await pro.agent
      .post('/v1/admin/withdrawals/pause')
      .set(CLIENT_HEADER)
      .send({ paused: true })
      .expect(403);
    await staff.agent
      .post('/v1/admin/withdrawals/pause')
      .set(CLIENT_HEADER)
      .send({ paused: true })
      .expect(200);
    expect((await wallet(pro)).withdrawalsPaused).toBe(true);
    await withdraw(pro, 100_000).expect(503);
    await staff.agent
      .post('/v1/admin/withdrawals/pause')
      .set(CLIENT_HEADER)
      .send({ paused: false })
      .expect(200);
    await withdraw(pro, 100_000).expect(200);
    const list = await staff.agent.get('/v1/admin/withdrawals').expect(200);
    expect(
      list.body.withdrawals.filter((w: { userId: string }) => w.userId === pro.userId),
    ).toHaveLength(2);
  });
});
