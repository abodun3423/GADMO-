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
import { maskContactInfo, type ReportProblem, reportProblemSchema } from '@gadmo/shared';
import { and, eq, or } from 'drizzle-orm';
import { AlertsService } from '../alerts/alerts.service';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { disputes, jobs, messages } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';
import { PaymentsService } from '../payments/payments.service';
import { BalanceService } from './balance.service';

const idPipe = new ZodValidationPipe(z.uuid());

/**
 * The customer's side of the end of a job (founder decisions): every balance is paid in the
 * app (there is no cash option, so every job is covered by the GADMO Guarantee),
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
