import {
  Body,
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
import {
  CASH_AGREEMENT_VERSION,
  type CashAgreement,
  cashAgreementSchema,
  type CashReceived,
  cashReceivedSchema,
  formatNaira,
  maskContactInfo,
  type ReportProblem,
  reportProblemSchema,
} from '@gadmo/shared';
import { and, eq, or, sql } from 'drizzle-orm';
import { AlertsService } from '../alerts/alerts.service';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditLogs, disputes, jobs, messages, payments } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';
import { PaymentsService } from '../payments/payments.service';
import { BalanceService, jobBalanceKobo } from './balance.service';

const idPipe = new ZodValidationPipe(z.uuid());

/**
 * The customer's side of the end of a job (founder decisions): pay the balance in the app,
 * where GADMO holds it for 12 hours; and confirm the work is good, which pays the Pro
 * straight away instead of waiting.
 */
@Controller('jobs/:jobId')
@UseGuards(JwtAuthGuard)
export class BalanceController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly payments: PaymentsService,
    private readonly balances: BalanceService,
    private readonly alerts: AlertsService,
  ) {}

  /** Starts paying the balance; the web app sends the customer to the checkout page. */
  @Post('balance/pay')
  @HttpCode(200)
  async pay(@CurrentUser() user: AuthUser, @Param('jobId', idPipe) jobId: string) {
    await this.assertCustomer(user, jobId);
    await enforceLimits(this.redis, [
      { key: `pay-start:${user.id}`, max: 20, windowSeconds: 60 * 60 },
    ]);
    return this.payments.startBalance(user.id, jobId);
  }

  /** "All good": the customer is happy with the work, so GADMO pays the Pro now. */
  @Post('confirm')
  @HttpCode(200)
  async confirm(@CurrentUser() user: AuthUser, @Param('jobId', idPipe) jobId: string) {
    const status = await this.assertCustomer(user, jobId);
    if (status !== 'BALANCE_HELD' || !(await this.balances.release(jobId, 'CONFIRMED'))) {
      throw new ConflictException(
        status === 'COMPLETED'
          ? 'This job is already complete.'
          : 'You can confirm the work once the balance is paid.',
      );
    }
    return { job: { id: jobId, status: 'COMPLETED' } };
  }

  /**
   * GADMO Guarantee: while the balance is held, the customer reports poor or unfinished
   * work. The money stays held and GADMO staff review the chat, quote and photos.
   */
  @Post('report-problem')
  @HttpCode(200)
  async report(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(reportProblemSchema)) body: ReportProblem,
  ) {
    await this.assertCustomer(user, jobId);
    await enforceLimits(this.redis, [
      { key: `report-problem:${user.id}`, max: 10, windowSeconds: 24 * 60 * 60 },
    ]);
    const reason = maskContactInfo(body.reason).text;
    const opened = await this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({
          status: jobs.status,
          proId: jobs.proId,
          releaseAt: jobs.balanceReleaseAt,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for('update');
      if (job!.status !== 'BALANCE_HELD' || !job!.releaseAt || job!.releaseAt <= new Date()) {
        throw new ConflictException(
          job!.status === 'DISPUTED'
            ? 'You’ve already reported a problem. GADMO is looking into it.'
            : 'A problem can be reported while GADMO is holding the payment, within 12 hours of paying.',
        );
      }
      const [dispute] = await tx
        .insert(disputes)
        .values({ jobId, openedById: user.id, reason })
        .returning({ id: disputes.id });
      await tx.update(jobs).set({ status: 'DISPUTED' }).where(eq(jobs.id, jobId));
      await tx.insert(messages).values({
        jobId,
        senderId: user.id,
        kind: 'EVENT',
        body: `The customer reported a problem with the work: “${reason}” GADMO keeps the payment on hold and will review the chat, the quote and any photos. Add photos here if they help.`,
      });
      return { proId: job!.proId, disputeId: dispute!.id };
    });
    if (opened.proId) {
      this.alerts.send(
        opened.proId,
        {
          title: 'Problem reported',
          body: 'The customer reported a problem with the work. GADMO is holding the payment and will review it.',
          url: `/jobs/${jobId}`,
          tag: `job-${jobId}`,
        },
        { sms: true },
      );
    }
    return {
      dispute: { id: opened.disputeId, status: 'OPEN' },
      job: { id: jobId, status: 'DISPUTED' },
    };
  }

  /**
   * The customer chooses to pay the balance in cash, after accepting the cash agreement
   * (founder decision): GADMO does not hold cash, takes no commission on it, and can't refund
   * it if the work is faulty. GADMO records who accepted which version of the text, and when.
   * Until the Pro confirms the cash, the customer can still pay in the app instead.
   */
  @Post('cash')
  @HttpCode(200)
  async chooseCash(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(cashAgreementSchema)) _body: CashAgreement,
  ) {
    await this.assertCustomer(user, jobId);
    const chosen = await this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          status: jobs.status,
          proId: jobs.proId,
          paymentMethod: jobs.paymentMethod,
          inspectionFeeKobo: jobs.inspectionFeeKobo,
          arrivedAt: jobs.arrivedAt,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for('update');
      if (job!.status !== 'DONE_AWAITING_PAYMENT') {
        throw new ConflictException(
          'You can choose cash once your Pro marks the job done, before paying.',
        );
      }
      if (job!.paymentMethod === 'CASH') throw new ConflictException('You’ve already chosen cash.');
      const balance = await jobBalanceKobo(tx, job!);
      if (!balance) throw new ConflictException('There is no balance to pay.');
      await tx
        .update(jobs)
        .set({
          paymentMethod: 'CASH',
          cashAgreementVersion: CASH_AGREEMENT_VERSION,
          cashAgreementAcceptedAt: sql`now()`,
        })
        .where(eq(jobs.id, jobId));
      await tx.insert(auditLogs).values({
        actorId: user.id,
        action: 'CASH_AGREEMENT_ACCEPTED',
        target: `job:${jobId}`,
        metadata: { version: CASH_AGREEMENT_VERSION, balanceKobo: balance },
      });
      await tx.insert(messages).values({
        jobId,
        senderId: user.id,
        kind: 'EVENT',
        body: `The customer chose to pay the ${naira(balance)} balance in cash and accepted the cash agreement: GADMO does not hold this money and can’t refund it. The Pro confirms here once they receive it.`,
      });
      return { proId: job!.proId, balance };
    });
    if (chosen.proId) {
      this.alerts.send(chosen.proId, {
        title: 'Paying in cash',
        body: `The customer will pay the ${naira(chosen.balance)} balance in cash. Confirm in the job chat once you receive it.`,
        url: `/jobs/${jobId}`,
        tag: `job-${jobId}`,
      });
    }
    return { job: { id: jobId, paymentMethod: 'CASH' } };
  }

  /** The Pro confirms the cash received; the job closes. No commission is taken on cash. */
  @Post('cash/received')
  @HttpCode(200)
  async cashReceived(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(cashReceivedSchema)) body: CashReceived,
  ) {
    const done = await this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({
          status: jobs.status,
          proId: jobs.proId,
          customerId: jobs.customerId,
          paymentMethod: jobs.paymentMethod,
        })
        .from(jobs)
        .where(and(eq(jobs.id, jobId), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))))
        .for('update');
      if (!job) throw new NotFoundException();
      if (job.proId !== user.id) {
        throw new ForbiddenException('Only the Pro confirms the cash they received.');
      }
      if (job.status !== 'DONE_AWAITING_PAYMENT' || job.paymentMethod !== 'CASH') {
        throw new ConflictException(
          job.status === 'CASH_COMPLETED'
            ? 'You’ve already confirmed the cash.'
            : 'The customer hasn’t chosen to pay in cash.',
        );
      }
      await tx.insert(payments).values({
        jobId,
        type: 'BALANCE',
        method: 'CASH',
        amountKobo: body.amountKobo,
        status: 'SUCCEEDED',
        paidAt: sql`now()`,
      });
      await tx.update(jobs).set({ status: 'CASH_COMPLETED' }).where(eq(jobs.id, jobId));
      await tx.insert(messages).values({
        jobId,
        senderId: user.id,
        kind: 'EVENT',
        body: `The Pro confirmed receiving ${naira(body.amountKobo)} in cash. Job complete.`,
      });
      return { customerId: job.customerId };
    });
    this.alerts.send(done.customerId, {
      title: 'Job complete',
      body: `Your Pro confirmed receiving ${naira(body.amountKobo)} in cash. Thank you for using GADMO.`,
      url: `/jobs/${jobId}`,
      tag: `job-${jobId}`,
    });
    return { job: { id: jobId, status: 'CASH_COMPLETED' } };
  }

  /** Only the job's customer; its Pro gets 403, anyone else 404. Returns the job status. */
  private async assertCustomer(user: AuthUser, jobId: string): Promise<string> {
    const [job] = await this.db
      .select({ customerId: jobs.customerId, status: jobs.status })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))))
      .limit(1);
    if (!job) throw new NotFoundException();
    if (job.customerId !== user.id) {
      throw new ForbiddenException('Only the customer pays and confirms the job.');
    }
    return job.status;
  }
}

function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
