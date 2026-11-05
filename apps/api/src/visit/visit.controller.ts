import { randomUUID, timingSafeEqual } from 'node:crypto';
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
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { formatNaira } from '@gadmo/shared';
import { and, eq, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import type { FieldCrypto } from '../common/field-crypto';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { jobs, ledgerEntries, messages } from '../db/schema';
import { DB, type Db, FIELD_CRYPTO, REDIS } from '../infra/infra.module';

const idPipe = new ZodValidationPipe(z.uuid());
const arrivalSchema = z
  .object({ code: z.string().regex(/^\d{4}$/, 'The arrival code has 4 digits.') })
  .strict();
type Arrival = z.infer<typeof arrivalSchema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Wrong codes allowed per job before a pause, so the code can't be guessed. */
const ARRIVAL_TRIES = 5;
const ARRIVAL_WINDOW_SECONDS = 15 * 60;

/**
 * The Pro's visit after the inspection fee is paid (PRD section 5): the Pro taps "On my
 * way", and on arrival enters the 4-digit code the customer sees in their chat. A correct
 * code proves the Pro is there and releases the held inspection fee to the Pro.
 */
@Controller('jobs/:jobId')
@UseGuards(JwtAuthGuard)
export class VisitController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
    private readonly alerts: AlertsService,
  ) {}

  @Post('on-the-way')
  @HttpCode(200)
  async onTheWay(@CurrentUser() user: AuthUser, @Param('jobId', idPipe) jobId: string) {
    let customerId: string | null = null;
    const result = await this.db.transaction(async (tx) => {
      const job = await this.lockForPro(tx, jobId, user);
      if (!job.onTheWayAt) {
        customerId = job.customerId;
        await tx
          .update(jobs)
          .set({ onTheWayAt: sql`now()` })
          .where(eq(jobs.id, jobId));
        await tx.insert(messages).values({
          jobId,
          senderId: user.id,
          kind: 'EVENT',
          body: 'Your Pro is on the way.',
        });
      }
      return { visit: await this.visit(tx, jobId) };
    });
    if (customerId) {
      this.alerts.send(
        customerId,
        {
          title: 'Your Pro is on the way',
          body: 'Your Pro is on the way. Have your arrival code ready from the job chat.',
          url: `/jobs/${jobId}`,
          tag: `job-${jobId}`,
        },
        { sms: true },
      );
    }
    return result;
  }

  @Post('arrived')
  @HttpCode(200)
  async arrived(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(arrivalSchema)) body: Arrival,
  ) {
    // Check the caller first so strangers can't use up a job's tries.
    await this.db.transaction((tx) => this.lockForPro(tx, jobId, user));
    await enforceLimits(this.redis, [
      { key: `arrival:${jobId}`, max: ARRIVAL_TRIES, windowSeconds: ARRIVAL_WINDOW_SECONDS },
    ]);
    const result = await this.db.transaction(async (tx) => {
      const job = await this.lockForPro(tx, jobId, user);
      const expected = this.expectedCode(job);
      const given = Buffer.from(body.code);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        throw new UnprocessableEntityException(
          'That code isn’t right. Ask the customer for the 4-digit arrival code in their GADMO chat.',
        );
      }
      const fee = job.inspectionFeeKobo!;
      const txnId = randomUUID();
      await tx.insert(ledgerEntries).values([
        {
          txnId,
          account: `escrow:job:${jobId}`,
          debitKobo: fee,
          jobId,
          description: 'Inspection fee released: the Pro arrived',
        },
        {
          txnId,
          account: `pro:${user.id}`,
          creditKobo: fee,
          jobId,
          description: 'Inspection fee for arriving',
        },
      ]);
      await tx
        .update(jobs)
        .set({ arrivedAt: sql`now()`, onTheWayAt: sql`coalesce(${jobs.onTheWayAt}, now())` })
        .where(eq(jobs.id, jobId));
      await tx.insert(messages).values({
        jobId,
        senderId: user.id,
        kind: 'EVENT',
        body: `Your Pro has arrived (arrival code confirmed). The inspection fee of ${naira(fee)} is now paid to the Pro.`,
      });
      return { customerId: job.customerId, visit: await this.visit(tx, jobId) };
    });
    this.alerts.send(result.customerId, {
      title: 'Your Pro has arrived',
      body: 'Your Pro has arrived and confirmed it with your code.',
      url: `/jobs/${jobId}`,
      tag: `job-${jobId}`,
    });
    return { visit: result.visit };
  }

  private async visit(tx: Tx, jobId: string) {
    const [v] = await tx
      .select({ onTheWayAt: jobs.onTheWayAt, arrivedAt: jobs.arrivedAt })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    return v!;
  }

  /** The job, locked, for its assigned Pro, while the visit is due. Others get 404. */
  private async lockForPro(tx: Tx, jobId: string, user: AuthUser) {
    const [job] = await tx
      .select({
        proId: jobs.proId,
        customerId: jobs.customerId,
        status: jobs.status,
        inspectionFeeKobo: jobs.inspectionFeeKobo,
        arrivalCodeEncrypted: jobs.arrivalCodeEncrypted,
        onTheWayAt: jobs.onTheWayAt,
        arrivedAt: jobs.arrivedAt,
      })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))))
      .for('update');
    if (!job) throw new NotFoundException();
    if (job.proId !== user.id) throw new ForbiddenException('Only the Pro updates the visit.');
    if (job.arrivedAt) throw new ConflictException('Your arrival is already confirmed.');
    if (job.status !== 'INSPECTION_PAID') {
      throw new ConflictException('The customer pays the inspection fee before the visit.');
    }
    return job;
  }

  /** The arrival code, which (for jobs paid before codes existed) needs the customer's chat. */
  private expectedCode(job: { arrivalCodeEncrypted: string | null }): Buffer {
    if (!job.arrivalCodeEncrypted) {
      throw new ConflictException(
        'Ask the customer to open this job’s chat in GADMO: their arrival code is shown there.',
      );
    }
    return this.crypto.decrypt(job.arrivalCodeEncrypted);
  }
}

function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
