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
import {
  balanceDue,
  formatNaira,
  maskContactInfo,
  type QuoteInput,
  quoteSchema,
} from '@gadmo/shared';
import { and, eq, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, jobs, messages, quotes } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';
import { PaymentsService } from '../payments/payments.service';

const idPipe = new ZodValidationPipe(z.uuid());
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Quotes (PRD section 5): once the Pro has seen the job (arrived for an inspection, or
 * straight away for services without one), they send a price as a card in the chat, with
 * an optional materials deposit of at most half. The customer accepts (paying the deposit
 * in the app, if any) or declines; the Pro can withdraw a quote not yet answered.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class QuotesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly payments: PaymentsService,
    private readonly alerts: AlertsService,
  ) {}

  @Post('jobs/:jobId/quotes')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(quoteSchema)) body: QuoteInput,
  ) {
    await enforceLimits(this.redis, [{ key: `quote:${user.id}`, max: 20, windowSeconds: 3600 }]);
    const { quote, job } = await this.db.transaction(async (tx) => {
      const job = await this.lockJob(tx, jobId, user);
      if (job.proId !== user.id) throw new ForbiddenException('The Pro sends the quote.');
      if (job.status === 'QUOTED') {
        throw new ConflictException(
          'Your quote is waiting for an answer. Withdraw it to change it.',
        );
      }
      const visitFirst =
        job.policy === 'REQUIRED' || (job.policy === 'OPTIONAL' && job.inspectionFeeKobo !== null);
      const ready =
        (job.status === 'ACCEPTED' && !visitFirst) ||
        (job.status === 'INSPECTION_PAID' && job.arrivedAt !== null);
      if (!ready) {
        throw new ConflictException(
          job.status === 'INSPECTION_PAID' || (job.status === 'ACCEPTED' && visitFirst)
            ? 'Quote after you’ve seen the job: arrive and enter the customer’s arrival code first.'
            : 'A quote can’t be sent at this stage.',
        );
      }
      const paidFee = job.status === 'INSPECTION_PAID' ? (job.inspectionFeeKobo ?? 0) : 0;
      if (body.amountKobo < paidFee) {
        throw new UnprocessableEntityException(
          `The quote can’t be less than the ${naira(paidFee)} inspection fee already paid; it counts toward the price.`,
        );
      }
      if (body.amountKobo - paidFee - body.depositKobo < 0) {
        throw new UnprocessableEntityException(
          'The deposit and the inspection fee together can’t be more than the quote.',
        );
      }
      const description = maskContactInfo(body.description).text;
      const [quote] = await tx
        .insert(quotes)
        .values({
          jobId,
          amountKobo: body.amountKobo,
          depositKobo: body.depositKobo,
          description,
        })
        .returning();
      await tx.update(jobs).set({ status: 'QUOTED' }).where(eq(jobs.id, jobId));
      await tx.insert(messages).values({
        jobId,
        senderId: user.id,
        kind: 'QUOTE',
        quoteId: quote!.id,
        body: `Quote: ${naira(body.amountKobo)}${body.depositKobo ? ` (deposit ${naira(body.depositKobo)})` : ''}. ${description}`,
      });
      return { quote: quote!, job };
    });
    this.alerts.send(
      job.customerId,
      {
        title: 'You have a quote',
        body: `Your Pro quoted ${naira(quote.amountKobo)} for the job. Review it in GADMO.`,
        url: `/jobs/${jobId}`,
        tag: `job-${jobId}`,
      },
      { sms: true },
    );
    return {
      quote: this.view(quote, job.status === 'INSPECTION_PAID' ? job.inspectionFeeKobo : null),
    };
  }

  /**
   * The customer accepts. With a deposit, this starts the payment and the quote is
   * accepted once GADMO confirms it; without one, it is accepted now.
   */
  @Post('quotes/:id/accept')
  @HttpCode(200)
  async accept(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string) {
    const quote = await this.quoteForCustomer(id, user);
    if (quote.depositKobo > 0) {
      const checkout = await this.payments.startDeposit(user.id, id);
      return { payment: checkout };
    }
    const done = await this.db.transaction(async (tx) => {
      const job = await this.lockJob(tx, quote.jobId, user);
      const [current] = await tx.select().from(quotes).where(eq(quotes.id, id)).for('update');
      if (current!.status !== 'PENDING' || job.status !== 'QUOTED') {
        throw new ConflictException('This quote can no longer be accepted.');
      }
      const [accepted] = await tx
        .update(quotes)
        .set({ status: 'ACCEPTED', acceptedAt: sql`now()`, respondedAt: sql`now()` })
        .where(eq(quotes.id, id))
        .returning();
      await tx.update(jobs).set({ status: 'QUOTE_ACCEPTED' }).where(eq(jobs.id, job.id));
      await this.event(tx, job.id, user.id, `Quote of ${naira(accepted!.amountKobo)} accepted.`);
      return { accepted: accepted!, job };
    });
    this.tellPro(
      done.job,
      'Quote accepted',
      `The customer accepted your ${naira(done.accepted.amountKobo)} quote. Start the work when you’re ready.`,
    );
    return { quote: this.view(done.accepted, null) };
  }

  @Post('quotes/:id/decline')
  @HttpCode(200)
  async decline(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string) {
    const quote = await this.quoteForCustomer(id, user);
    const done = await this.close(
      quote.jobId,
      id,
      user,
      'DECLINED',
      'Quote declined. Your Pro can send a new one.',
    );
    this.tellPro(
      done.job,
      'Quote declined',
      'The customer declined your quote. Talk it over in the chat and send a new one.',
    );
    return { quote: this.view(done.quote, null) };
  }

  @Post('quotes/:id/withdraw')
  @HttpCode(200)
  async withdraw(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string) {
    const [found] = await this.db
      .select({ jobId: quotes.jobId })
      .from(quotes)
      .innerJoin(jobs, eq(jobs.id, quotes.jobId))
      .where(and(eq(quotes.id, id), or(eq(jobs.proId, user.id), eq(jobs.customerId, user.id))));
    if (!found) throw new NotFoundException();
    const done = await this.close(
      found.jobId,
      id,
      user,
      'WITHDRAWN',
      'The Pro withdrew the quote.',
      true,
    );
    return { quote: this.view(done.quote, null) };
  }

  /** Declines or withdraws a waiting quote; the job goes back to before it was quoted. */
  private async close(
    jobId: string,
    quoteId: string,
    user: AuthUser,
    status: 'DECLINED' | 'WITHDRAWN',
    note: string,
    byPro = false,
  ) {
    return this.db.transaction(async (tx) => {
      const job = await this.lockJob(tx, jobId, user);
      if (byPro && job.proId !== user.id)
        throw new ForbiddenException('Only the Pro withdraws a quote.');
      const [current] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for('update');
      if (current!.status !== 'PENDING' || job.status !== 'QUOTED') {
        throw new ConflictException('This quote was already answered.');
      }
      const [closed] = await tx
        .update(quotes)
        .set({ status, respondedAt: sql`now()` })
        .where(eq(quotes.id, quoteId))
        .returning();
      await tx
        .update(jobs)
        .set({ status: job.arrivedAt ? 'INSPECTION_PAID' : 'ACCEPTED' })
        .where(eq(jobs.id, jobId));
      await this.event(tx, jobId, user.id, note);
      return { quote: closed!, job };
    });
  }

  /** A quote the caller may answer as the job's customer; others get 404 (or 403 for the Pro). */
  private async quoteForCustomer(id: string, user: AuthUser) {
    const [row] = await this.db
      .select({
        jobId: quotes.jobId,
        depositKobo: quotes.depositKobo,
        customerId: jobs.customerId,
        proId: jobs.proId,
      })
      .from(quotes)
      .innerJoin(jobs, eq(jobs.id, quotes.jobId))
      .where(and(eq(quotes.id, id), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))));
    if (!row) throw new NotFoundException();
    if (row.customerId !== user.id) throw new ForbiddenException('The customer answers the quote.');
    return row;
  }

  private view(q: typeof quotes.$inferSelect, inspectionFeeKobo: number | null) {
    return {
      id: q.id,
      amountKobo: q.amountKobo,
      depositKobo: q.depositKobo,
      description: q.description,
      status: q.status,
      createdAt: q.createdAt,
      ...(inspectionFeeKobo !== null
        ? {
            balanceKobo: balanceDue({
              quoteKobo: q.amountKobo,
              inspectionFeeKobo,
              depositKobo: q.depositKobo,
            }),
          }
        : {}),
    };
  }

  private tellPro(job: { id: string; proId: string | null }, title: string, body: string): void {
    if (!job.proId) return;
    this.alerts.send(job.proId, { title, body, url: `/jobs/${job.id}`, tag: `job-${job.id}` });
  }

  private async event(tx: Tx, jobId: string, by: string, body: string): Promise<void> {
    await tx.insert(messages).values({ jobId, senderId: by, kind: 'EVENT', body });
  }

  /** The job, locked, if the caller is one of its two parties; otherwise 404. */
  private async lockJob(tx: Tx, jobId: string, user: AuthUser) {
    const [job] = await tx
      .select({
        id: jobs.id,
        customerId: jobs.customerId,
        proId: jobs.proId,
        status: jobs.status,
        inspectionFeeKobo: jobs.inspectionFeeKobo,
        arrivedAt: jobs.arrivedAt,
        policy: categories.inspectionPolicy,
      })
      .from(jobs)
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .where(and(eq(jobs.id, jobId), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))))
      .for('update', { of: jobs });
    if (!job) throw new NotFoundException();
    return job;
  }
}

function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
