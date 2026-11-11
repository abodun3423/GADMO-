import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  BALANCE_HOLD_HOURS,
  balanceDue,
  COMMISSION_BPS,
  formatNaira,
  percentOf,
} from '@gadmo/shared';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { AlertsService } from '../alerts/alerts.service';
import { ENV, type Env } from '../config/env';
import { jobs, ledgerEntries, messages, quotes } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** How often held balances are checked for release. */
const TICK_MS = 60_000;

/** The account GADMO's commission is paid into. */
export const COMMISSION_ACCOUNT = 'gadmo:commission';

/** The quote the customer accepted for a job (the newest, should there be several). */
export async function acceptedQuote(db: Db | Tx, jobId: string) {
  const [quote] = await db
    .select({ amountKobo: quotes.amountKobo, depositKobo: quotes.depositKobo })
    .from(quotes)
    .where(and(eq(quotes.jobId, jobId), eq(quotes.status, 'ACCEPTED')))
    .orderBy(desc(quotes.acceptedAt))
    .limit(1);
  return quote ?? null;
}

/**
 * What the customer still owes once the work is done: the accepted quote minus the
 * inspection fee (only if the Pro came and it was paid) and the materials deposit.
 */
export async function jobBalanceKobo(
  db: Db | Tx,
  job: { id: string; inspectionFeeKobo: number | null; arrivedAt: Date | null },
): Promise<number | null> {
  const quote = await acceptedQuote(db, job.id);
  if (!quote) return null;
  return balanceDue({
    quoteKobo: quote.amountKobo,
    inspectionFeeKobo: job.arrivedAt ? (job.inspectionFeeKobo ?? 0) : 0,
    depositKobo: quote.depositKobo,
  });
}

/** The money in an account, from the ledger. */
export async function accountBalance(db: Db | Tx, account: string): Promise<number> {
  const [row] = await db
    .select({
      kobo: sql<string>`coalesce(sum(${ledgerEntries.creditKobo} - ${ledgerEntries.debitKobo}), 0)`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.account, account));
  return Number(row?.kobo ?? 0);
}

/**
 * The end of a job paid in the app (founder decisions): the balance is held for
 * BALANCE_HOLD_HOURS, then paid to the Pro, or sooner if the customer confirms the work.
 * GADMO's commission, 10% of the whole quote, is taken once, at that moment; if the
 * balance doesn't cover it, the rest comes from the Pro's wallet. A job whose customer has
 * reported poor work is no longer BALANCE_HELD, so it is never released here.
 */
@Injectable()
export class BalanceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Balance');
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly alerts: AlertsService,
  ) {}

  onModuleInit(): void {
    // Tests release explicitly, so no background timer there.
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick(); // catch up on anything that came due while the server slept
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Starts the hold on a job whose balance is settled (paid in the app, or nothing due). */
  async hold(tx: Tx, jobId: string): Promise<Date> {
    const releaseAt = new Date(Date.now() + BALANCE_HOLD_HOURS * 60 * 60 * 1000);
    await tx
      .update(jobs)
      .set({ status: 'BALANCE_HELD', balanceReleaseAt: releaseAt })
      .where(eq(jobs.id, jobId));
    return releaseAt;
  }

  /** Releases every held balance whose time is up. */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let released = 0;
    try {
      const due = await this.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.status, 'BALANCE_HELD'), lte(jobs.balanceReleaseAt, sql`now()`)))
        .limit(100);
      for (const { id } of due) {
        try {
          if (await this.release(id, 'TIME_UP')) released++;
        } catch (err) {
          this.log.error(`Could not release job ${id}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.ticking = false;
    }
    return released;
  }

  /**
   * Pays the held balance to the Pro and takes GADMO's commission, once. Returns false if
   * the job is not (or no longer) waiting for release.
   */
  async release(jobId: string, why: 'CONFIRMED' | 'TIME_UP'): Promise<boolean> {
    const done = await this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          status: jobs.status,
          proId: jobs.proId,
          customerId: jobs.customerId,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for('update');
      if (!job || job.status !== 'BALANCE_HELD' || !job.proId) return null;
      const quote = await acceptedQuote(tx, jobId);
      const held = await accountBalance(tx, `escrow:job:${jobId}`);
      const commission = quote ? percentOf(quote.amountKobo, COMMISSION_BPS) : 0;
      const pro = `pro:${job.proId}`;
      const txnId = randomUUID();
      const entries: (typeof ledgerEntries.$inferInsert)[] = [];
      if (held > 0) {
        entries.push(
          {
            txnId,
            account: `escrow:job:${jobId}`,
            debitKobo: held,
            jobId,
            description: 'Balance released to the Pro',
          },
          { txnId, account: pro, creditKobo: held, jobId, description: 'Job balance' },
        );
      }
      if (commission > 0) {
        entries.push(
          {
            txnId,
            account: pro,
            debitKobo: commission,
            jobId,
            description: 'GADMO commission (10% of the quote)',
          },
          {
            txnId,
            account: COMMISSION_ACCOUNT,
            creditKobo: commission,
            jobId,
            description: 'Commission',
          },
        );
      }
      if (entries.length > 0) await tx.insert(ledgerEntries).values(entries);
      await tx.update(jobs).set({ status: 'COMPLETED' }).where(eq(jobs.id, jobId));
      await tx.insert(messages).values({
        jobId,
        senderId: why === 'CONFIRMED' ? job.customerId : job.proId,
        kind: 'EVENT',
        body:
          why === 'CONFIRMED'
            ? 'The customer confirmed the work is good. GADMO has paid the Pro. Job complete.'
            : `No problem was reported within ${BALANCE_HOLD_HOURS} hours, so GADMO has paid the Pro. Job complete.`,
      });
      return { proId: job.proId, net: held - commission, held, commission };
    });
    if (!done) return false;
    this.alerts.send(done.proId, {
      title: 'Payment released',
      body:
        done.held > 0
          ? `GADMO paid the ${naira(done.held)} balance into your wallet, less ${naira(done.commission)} commission.`
          : `Job complete. GADMO’s ${naira(done.commission)} commission was taken from your wallet.`,
      url: `/jobs/${jobId}`,
      tag: `job-${jobId}`,
    });
    return true;
  }
}

function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
