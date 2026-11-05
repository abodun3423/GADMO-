import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { formatNaira, MIN_WITHDRAWAL_KOBO } from '@gadmo/shared';
import { and, desc, eq, inArray, like, lt, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { AuthUser } from '../auth/guards';
import type { FieldCrypto } from '../common/field-crypto';
import { bankAccounts, jobs, ledgerEntries, users, withdrawals } from '../db/schema';
import { DB, type Db, FIELD_CRYPTO, REDIS } from '../infra/infra.module';
import { PAYMENT_GATEWAY, type PaymentGateway, type TransferStatus } from '../payments/gateway';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Staff can pause every withdrawal at once (e.g. while checking a suspected fraud). */
export const PAUSE_KEY = 'settings:withdrawals-paused';
export const WITHDRAWAL_REFERENCE = /^gadmo_w_[0-9a-f]{32}$/;
const IN_TRANSIT = 'withdrawals:in-transit';

/** The ledger account that is a person's GADMO wallet. */
export function walletAccount(user: { id: string; role: string }): string {
  return user.role === 'PRO' ? `pro:${user.id}` : `refund-due:customer:${user.id}`;
}

/**
 * Wallets (founder decisions, 5 Nov): a Pro's earnings and a customer's refunds, with their
 * history, withdrawable to the person's own bank account through Paystack Transfers.
 * ₦1,000 minimum; GADMO pays the transfer fee. Customers can't add money (no top-ups).
 * Every movement is a balanced ledger entry; a failed transfer puts the money back.
 */
@Injectable()
export class WalletService {
  private readonly log = new Logger('Wallet');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(PAYMENT_GATEWAY) readonly gateway: PaymentGateway,
  ) {}

  async paused(): Promise<boolean> {
    return (await this.redis.get(PAUSE_KEY)) === '1';
  }

  async balance(db: Db | Tx, account: string): Promise<number> {
    const [row] = await db
      .select({
        kobo: sql<string>`coalesce(sum(${ledgerEntries.creditKobo} - ${ledgerEntries.debitKobo}), 0)`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.account, account));
    return Number(row?.kobo ?? 0);
  }

  async overview(user: AuthUser) {
    await this.recheckStale(user.id);
    const account = walletAccount(user);
    const balanceKobo = await this.balance(this.db, account);
    let heldKobo = 0;
    if (user.role === 'PRO') {
      const [held] = await this.db
        .select({
          kobo: sql<string>`coalesce(sum(${ledgerEntries.creditKobo} - ${ledgerEntries.debitKobo}), 0)`,
        })
        .from(ledgerEntries)
        .innerJoin(jobs, eq(jobs.id, ledgerEntries.jobId))
        .where(and(eq(jobs.proId, user.id), like(ledgerEntries.account, 'escrow:job:%')));
      heldKobo = Number(held?.kobo ?? 0);
    }
    const entries = await this.db
      .select({
        id: ledgerEntries.id,
        description: ledgerEntries.description,
        creditKobo: ledgerEntries.creditKobo,
        debitKobo: ledgerEntries.debitKobo,
        jobId: ledgerEntries.jobId,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.account, account))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(50);
    const recent = await this.db
      .select({
        id: withdrawals.id,
        amountKobo: withdrawals.amountKobo,
        destination: withdrawals.destination,
        status: withdrawals.status,
        createdAt: withdrawals.createdAt,
        paidAt: withdrawals.paidAt,
      })
      .from(withdrawals)
      .where(eq(withdrawals.userId, user.id))
      .orderBy(desc(withdrawals.createdAt))
      .limit(20);
    const [bank] = await this.db
      .select({
        bankName: bankAccounts.bankName,
        last4: bankAccounts.last4,
        accountName: bankAccounts.accountName,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, user.id));
    return {
      wallet: {
        balanceKobo,
        heldKobo,
        minWithdrawalKobo: MIN_WITHDRAWAL_KOBO,
        withdrawalsPaused: await this.paused(),
        bankAccount: bank ?? null,
        entries,
        withdrawals: recent,
      },
    };
  }

  /** Checks the account with the bank, registers it with Paystack, and saves it. */
  async setBankAccount(user: AuthUser, bankCode: string, accountNumber: string) {
    const bank = (await this.safe(() => this.gateway.listBanks())).find((b) => b.code === bankCode);
    if (!bank) throw new UnprocessableEntityException('Choose your bank from the list.');
    const accountName = await this.safe(() => this.gateway.resolveAccount(accountNumber, bankCode));
    if (!accountName) {
      throw new UnprocessableEntityException(
        'We couldn’t find that account. Check the account number and the bank.',
      );
    }
    const recipientCode = await this.safe(() =>
      this.gateway.createRecipient(accountName, accountNumber, bankCode),
    );
    const values = {
      bankCode,
      bankName: bank.name,
      accountNumberEncrypted: this.crypto.encrypt(accountNumber),
      last4: accountNumber.slice(-4),
      accountName,
      recipientCode,
    };
    await this.db
      .insert(bankAccounts)
      .values({ userId: user.id, ...values })
      .onConflictDoUpdate({ target: bankAccounts.userId, set: values });
    return { bankAccount: { bankName: bank.name, last4: values.last4, accountName } };
  }

  /** Sends money from the wallet to the saved bank account. */
  async withdraw(user: AuthUser, amountKobo: number) {
    if (await this.paused()) {
      throw new ServiceUnavailableException(
        'Withdrawals are paused for a short while. Your money is safe; try again later.',
      );
    }
    const account = walletAccount(user);
    const prepared = await this.db.transaction(async (tx) => {
      // One withdrawal at a time per person, so the balance can't be spent twice.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wallet:${user.id}`}))`);
      const [bank] = await tx.select().from(bankAccounts).where(eq(bankAccounts.userId, user.id));
      if (!bank) throw new ConflictException('Add your bank account first.');
      const balance = await this.balance(tx, account);
      if (amountKobo > balance) {
        throw new ConflictException(
          `You can withdraw up to ${naira(balance)}, your available balance.`,
        );
      }
      const reference = `gadmo_w_${randomUUID().replace(/-/g, '')}`;
      const destination = `${bank.bankName} ••••${bank.last4}`;
      const [w] = await tx
        .insert(withdrawals)
        .values({
          userId: user.id,
          reference,
          amountKobo,
          destination,
          recipientCode: bank.recipientCode,
        })
        .returning();
      const txnId = randomUUID();
      await tx.insert(ledgerEntries).values([
        { txnId, account, debitKobo: amountKobo, description: `Withdrawal to ${destination}` },
        {
          txnId,
          account: IN_TRANSIT,
          creditKobo: amountKobo,
          description: `Withdrawal ${reference}`,
        },
      ]);
      return w!;
    });
    const status = await this.gateway.transfer({
      reference: prepared.reference,
      amountKobo,
      recipientCode: prepared.recipientCode,
      reason: 'GADMO wallet withdrawal',
    });
    const withdrawal = await this.settle(prepared.reference, status);
    return { withdrawal };
  }

  /** Asks the provider and records the outcome; safe to call any number of times. */
  async recheck(reference: string) {
    const status = await this.gateway.verifyTransfer(reference).catch(() => 'pending' as const);
    return this.settle(reference, status);
  }

  /** Withdrawals still in progress after a few minutes are checked again on the next visit. */
  private async recheckStale(userId: string): Promise<void> {
    const stale = await this.db
      .select({ reference: withdrawals.reference })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.userId, userId),
          eq(withdrawals.status, 'PROCESSING'),
          lt(withdrawals.createdAt, sql`now() - interval '2 minutes'`),
        ),
      )
      .limit(5);
    for (const w of stale) await this.recheck(w.reference);
  }

  private async settle(reference: string, status: TransferStatus) {
    return this.db.transaction(async (tx) => {
      const [w] = await tx
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.reference, reference))
        .for('update');
      if (!w) return null;
      const view = (s: typeof w) => ({
        id: s.id,
        amountKobo: s.amountKobo,
        destination: s.destination,
        status: s.status,
        createdAt: s.createdAt,
        paidAt: s.paidAt,
      });
      if (w.status !== 'PROCESSING' || status === 'pending') return view(w);
      const txnId = randomUUID();
      if (status === 'success') {
        const [done] = await tx
          .update(withdrawals)
          .set({ status: 'PAID', paidAt: sql`now()` })
          .where(eq(withdrawals.id, w.id))
          .returning();
        await tx.insert(ledgerEntries).values([
          {
            txnId,
            account: IN_TRANSIT,
            debitKobo: w.amountKobo,
            description: `Withdrawal ${reference} paid`,
          },
          {
            txnId,
            account: `gateway:${this.gateway.name}:clearing`,
            creditKobo: w.amountKobo,
            description: `Withdrawal ${reference} paid out`,
          },
        ]);
        return view(done!);
      }
      // Failed: the money goes back to the wallet.
      const [failed] = await tx
        .update(withdrawals)
        .set({ status: 'FAILED' })
        .where(eq(withdrawals.id, w.id))
        .returning();
      const [owner] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, w.userId));
      this.log.warn(`Withdrawal ${reference} failed; returned to the wallet`);
      await tx.insert(ledgerEntries).values([
        {
          txnId,
          account: IN_TRANSIT,
          debitKobo: w.amountKobo,
          description: `Withdrawal ${reference} failed`,
        },
        {
          txnId,
          account: walletAccount(owner!),
          creditKobo: w.amountKobo,
          description: `Withdrawal to ${w.destination} failed: money returned`,
        },
      ]);
      return view(failed!);
    });
  }

  /** Staff: recent withdrawals with who made them. */
  async recentForStaff(statuses?: ('PROCESSING' | 'PAID' | 'FAILED')[]) {
    return this.db
      .select({
        id: withdrawals.id,
        userId: withdrawals.userId,
        name: users.name,
        role: users.role,
        amountKobo: withdrawals.amountKobo,
        destination: withdrawals.destination,
        status: withdrawals.status,
        createdAt: withdrawals.createdAt,
        paidAt: withdrawals.paidAt,
      })
      .from(withdrawals)
      .innerJoin(users, eq(users.id, withdrawals.userId))
      .where(statuses ? inArray(withdrawals.status, statuses) : undefined)
      .orderBy(desc(withdrawals.createdAt))
      .limit(100);
  }

  private async safe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      this.log.error(`Bank service error: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'We couldn’t reach the bank service. Try again in a few minutes.',
      );
    }
  }
}

function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
