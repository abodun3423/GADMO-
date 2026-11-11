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
import { and, eq, or } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { jobs } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';
import { PaymentsService } from '../payments/payments.service';
import { BalanceService } from './balance.service';

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
