import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BALANCE_HOLD_HOURS, balanceDue, formatNaira } from '@gadmo/shared';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { jobs, ledgerEntries, messages, quotes } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';
import { accountBalance, BalanceService } from './balance.service';

const idPipe = new ZodValidationPipe(z.uuid());
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The work itself (PRD section 5), after the customer accepts a quote: the Pro taps
 * "Start work" so the customer can follow along, then "Job done", after which the balance
 * (quote minus inspection fee minus deposit) is due. The materials deposit already reached
 * the Pro when the customer paid it.
 */
@Controller('jobs/:jobId')
@UseGuards(JwtAuthGuard)
export class WorkController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly alerts: AlertsService,
    private readonly balances: BalanceService,
  ) {}

  @Post('start-work')
  @HttpCode(200)
  async start(@CurrentUser() user: AuthUser, @Param('jobId', idPipe) jobId: string) {
    const done = await this.db.transaction(async (tx) => {
      const job = await this.lockForPro(tx, jobId, user);
      if (job.status !== 'QUOTE_ACCEPTED') {
        throw new ConflictException(
          job.status === 'IN_PROGRESS'
            ? 'You’ve already started this job.'
            : 'Work starts once the customer has accepted your quote.',
        );
      }
      const quote = await this.acceptedQuote(tx, jobId);
      // Deposits now go to the Pro as soon as they are paid. One paid earlier, while GADMO
      // still held deposits until work started, is still in the job's escrow: release it.
      const [held] = await tx
        .select({
          kobo: sql<string>`coalesce(sum(${ledgerEntries.creditKobo} - ${ledgerEntries.debitKobo}), 0)`,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.account, `escrow:job:${jobId}`));
      const deposit = Math.min(Number(held!.kobo), quote.depositKobo);
      if (deposit > 0) {
        const txnId = randomUUID();
        await tx.insert(ledgerEntries).values([
          {
            txnId,
            account: `escrow:job:${jobId}`,
            debitKobo: deposit,
            jobId,
            description: 'Materials deposit released: work started',
          },
          {
            txnId,
            account: `pro:${user.id}`,
            creditKobo: deposit,
            jobId,
            description: 'Materials deposit',
          },
        ]);
      }
      await tx
        .update(jobs)
        .set({ status: 'IN_PROGRESS', startedAt: sql`now()` })
        .where(eq(jobs.id, jobId));
      await this.event(
        tx,
        jobId,
        user.id,
        deposit > 0
          ? `Your Pro has started the work. The materials deposit of ${naira(deposit)} is now paid to the Pro.`
          : 'Your Pro has started the work.',
      );
      return { customerId: job.customerId, deposit };
    });
    this.alerts.send(done.customerId, {
      title: 'Work has started',
      body: 'Your Pro has started the work. Follow along in the job chat.',
      url: `/jobs/${jobId}`,
      tag: `job-${jobId}`,
    });
    return { job: await this.work(jobId), depositReleasedKobo: done.deposit };
  }

  @Post('work-done')
  @HttpCode(200)
  async finish(@CurrentUser() user: AuthUser, @Param('jobId', idPipe) jobId: string) {
    const done = await this.db.transaction(async (tx) => {
      const job = await this.lockForPro(tx, jobId, user);
      if (job.status !== 'IN_PROGRESS') {
        throw new ConflictException(
          job.status === 'QUOTE_ACCEPTED'
            ? 'Tap “Start work” first.'
            : 'This job isn’t in progress, so it can’t be marked done.',
        );
      }
      const quote = await this.acceptedQuote(tx, jobId);
      const balance = balanceDue({
        quoteKobo: quote.amountKobo,
        // The fee counts toward the price only when it was paid (the Pro came to inspect).
        inspectionFeeKobo: job.arrivedAt ? (job.inspectionFeeKobo ?? 0) : 0,
        depositKobo: quote.depositKobo,
      });
      await tx
        .update(jobs)
        .set({ status: 'DONE_AWAITING_PAYMENT', doneAt: sql`now()` })
        .where(eq(jobs.id, jobId));
      // Nothing left to pay, or the Pro fixed the work after a report (the balance is still
      // held): the customer gets a new window to report a problem.
      const alreadyPaid =
        balance > 0 && (await accountBalance(tx, `escrow:job:${jobId}`)) >= balance;
      if (balance === 0 || alreadyPaid) await this.balances.hold(tx, jobId);
      await this.event(
        tx,
        jobId,
        user.id,
        alreadyPaid
          ? `Your Pro marked the job done again. GADMO still holds your payment: check the work, and report a problem within ${BALANCE_HOLD_HOURS} hours if it’s not right.`
          : balance > 0
            ? `Your Pro marked the job done. Balance to pay: ${naira(balance)}.`
            : `Your Pro marked the job done. Nothing more to pay. If something is wrong with the work, report it within ${BALANCE_HOLD_HOURS} hours.`,
      );
      return { customerId: job.customerId, balance, alreadyPaid };
    });
    this.alerts.send(
      done.customerId,
      {
        title: 'Job done',
        body:
          done.balance > 0 && !done.alreadyPaid
            ? `Your Pro marked the job done. Check the work, then pay the ${naira(done.balance)} balance in GADMO.`
            : 'Your Pro marked the job done. Check the work in GADMO.',
        url: `/jobs/${jobId}`,
        tag: `job-${jobId}`,
      },
      { sms: true },
    );
    return { job: await this.work(jobId), balanceKobo: done.balance };
  }

  private async work(jobId: string) {
    const [row] = await this.db
      .select({
        id: jobs.id,
        status: jobs.status,
        startedAt: jobs.startedAt,
        doneAt: jobs.doneAt,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    return row!;
  }

  /** The quote the customer accepted for this job (the newest, should there be several). */
  private async acceptedQuote(tx: Tx, jobId: string) {
    const [quote] = await tx
      .select({ amountKobo: quotes.amountKobo, depositKobo: quotes.depositKobo })
      .from(quotes)
      .where(and(eq(quotes.jobId, jobId), eq(quotes.status, 'ACCEPTED')))
      .orderBy(desc(quotes.acceptedAt))
      .limit(1);
    if (!quote) throw new ConflictException('This job has no accepted quote.');
    return quote;
  }

  /** The job, locked, for its assigned Pro. The customer gets 403; anyone else 404. */
  private async lockForPro(tx: Tx, jobId: string, user: AuthUser) {
    const [job] = await tx
      .select({
        proId: jobs.proId,
        customerId: jobs.customerId,
        status: jobs.status,
        inspectionFeeKobo: jobs.inspectionFeeKobo,
        arrivedAt: jobs.arrivedAt,
      })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))))
      .for('update');
    if (!job) throw new NotFoundException();
    if (job.proId !== user.id) throw new ForbiddenException('Only the Pro updates the work.');
    return job;
  }

  private async event(tx: Tx, jobId: string, by: string, body: string): Promise<void> {
    await tx.insert(messages).values({ jobId, senderId: by, kind: 'EVENT', body });
  }
}

function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
