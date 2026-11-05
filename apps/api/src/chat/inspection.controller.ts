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
  formatNaira,
  type InspectionOfferInput,
  inspectionOfferSchema,
  maskContactInfo,
} from '@gadmo/shared';
import { and, eq, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, inspectionOffers, jobs, messages } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';

const idPipe = new ZodValidationPipe(z.uuid());
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The inspection fee, agreed in chat (PRD section 5): the Pro offers an amount (never above
 * ₦5,000) based on distance, urgency and the job; the customer accepts, counters or
 * declines, and the Pro can answer a counter the same way. Only for services whose
 * inspection policy is REQUIRED or OPTIONAL. Each step also appears in the chat.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class InspectionController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly alerts: AlertsService,
  ) {}

  /** Tells the other person about an offer step (after the change is saved). */
  private tell(
    job: { id: string; customerId: string; proId: string | null },
    by: string,
    body: string,
  ) {
    const to = by === job.customerId ? job.proId : job.customerId;
    if (!to) return;
    this.alerts.send(to, {
      title: 'Inspection fee',
      body,
      url: `/jobs/${job.id}`,
      tag: `fee-${job.id}`,
    });
  }

  /** The Pro's first offer (or a fresh one after a decline). */
  @Post('jobs/:jobId/inspection-offers')
  async propose(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(inspectionOfferSchema)) body: InspectionOfferInput,
  ) {
    await this.limit(user);
    const { job, offer } = await this.db.transaction(async (tx) => {
      const job = await this.lockJob(tx, jobId, user);
      if (job.proId !== user.id) {
        throw new ForbiddenException('The Pro proposes the inspection fee.');
      }
      this.assertNegotiable(job);
      const [pending] = await tx
        .select({ id: inspectionOffers.id })
        .from(inspectionOffers)
        .where(and(eq(inspectionOffers.jobId, jobId), eq(inspectionOffers.status, 'PENDING')));
      if (pending) throw new ConflictException('There is already an offer waiting for an answer.');
      return { job, offer: await this.createOffer(tx, jobId, user.id, body) };
    });
    this.tell(
      job,
      user.id,
      `Your Pro offered an inspection fee of ${naira(offer.amountKobo)}. Accept, counter or decline in GADMO.`,
    );
    return { offer };
  }

  @Post('inspection-offers/:id/accept')
  @HttpCode(200)
  async accept(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string) {
    const result = await this.db.transaction(async (tx) => {
      const { offer, job } = await this.lockOfferForAnswer(tx, id, user);
      await tx
        .update(inspectionOffers)
        .set({ status: 'ACCEPTED', respondedAt: sql`now()` })
        .where(eq(inspectionOffers.id, offer.id));
      await tx
        .update(jobs)
        .set({ inspectionFeeKobo: offer.amountKobo, inspectionAgreedAt: sql`now()` })
        .where(eq(jobs.id, job.id));
      await this.event(tx, job.id, user.id, `Inspection fee agreed: ${naira(offer.amountKobo)}.`);
      return {
        job,
        offer: { ...offer, status: 'ACCEPTED' as const },
        inspectionFeeKobo: offer.amountKobo,
      };
    });
    const { job, ...response } = result;
    this.tell(
      job,
      user.id,
      user.id === job.customerId
        ? `The customer accepted your inspection fee of ${naira(response.inspectionFeeKobo)}. They pay it in the app before your visit.`
        : `Your Pro accepted ${naira(response.inspectionFeeKobo)} as the inspection fee. Pay it in GADMO so they can visit.`,
    );
    return response;
  }

  @Post('inspection-offers/:id/counter')
  async counter(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(inspectionOfferSchema)) body: InspectionOfferInput,
  ) {
    await this.limit(user);
    const countered = await this.db.transaction(async (tx) => {
      const { offer, job } = await this.lockOfferForAnswer(tx, id, user);
      if (body.amountKobo === offer.amountKobo) {
        throw new ConflictException('That is the same amount. Accept the offer instead.');
      }
      await tx
        .update(inspectionOffers)
        .set({ status: 'COUNTERED', respondedAt: sql`now()` })
        .where(eq(inspectionOffers.id, offer.id));
      return { job, offer: await this.createOffer(tx, job.id, user.id, body) };
    });
    this.tell(
      countered.job,
      user.id,
      `${user.id === countered.job.customerId ? 'The customer' : 'Your Pro'} countered with ${naira(countered.offer.amountKobo)}. Answer in GADMO.`,
    );
    return { offer: countered.offer };
  }

  @Post('inspection-offers/:id/decline')
  @HttpCode(200)
  async decline(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string) {
    return this.db.transaction(async (tx) => {
      const { offer, job } = await this.lockOfferForAnswer(tx, id, user);
      await tx
        .update(inspectionOffers)
        .set({ status: 'DECLINED', respondedAt: sql`now()` })
        .where(eq(inspectionOffers.id, offer.id));
      await this.event(tx, job.id, user.id, `Offer of ${naira(offer.amountKobo)} declined.`);
      return { offer: { ...offer, status: 'DECLINED' as const } };
    });
  }

  private async createOffer(tx: Tx, jobId: string, byId: string, body: InspectionOfferInput) {
    const note = body.note ? maskContactInfo(body.note).text : null;
    const [offer] = await tx
      .insert(inspectionOffers)
      .values({ jobId, proposedById: byId, amountKobo: body.amountKobo, note })
      .returning({
        id: inspectionOffers.id,
        amountKobo: inspectionOffers.amountKobo,
        note: inspectionOffers.note,
        status: inspectionOffers.status,
        createdAt: inspectionOffers.createdAt,
      });
    await tx.insert(messages).values({
      jobId,
      senderId: byId,
      kind: 'OFFER',
      offerId: offer!.id,
      body: `Inspection fee offer: ${naira(body.amountKobo)}${note ? `. ${note}` : ''}`,
    });
    return offer!;
  }

  private async event(tx: Tx, jobId: string, byId: string, body: string): Promise<void> {
    await tx.insert(messages).values({ jobId, senderId: byId, kind: 'EVENT', body });
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
        policy: categories.inspectionPolicy,
      })
      .from(jobs)
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .where(and(eq(jobs.id, jobId), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))))
      .for('update', { of: jobs });
    if (!job) throw new NotFoundException();
    return job;
  }

  private assertNegotiable(job: {
    proId: string | null;
    status: string;
    inspectionFeeKobo: number | null;
    policy: string;
  }): void {
    if (job.policy === 'NONE') {
      throw new ConflictException('This service has no inspection fee. The Pro quotes directly.');
    }
    if (job.inspectionFeeKobo !== null) {
      throw new ConflictException('The inspection fee is already agreed.');
    }
    if (!job.proId || job.status !== 'ACCEPTED') {
      throw new ConflictException('The inspection fee can’t be changed at this stage.');
    }
  }

  /** A pending offer the caller may answer: they are a party and not the one who made it. */
  private async lockOfferForAnswer(tx: Tx, offerId: string, user: AuthUser) {
    const [found] = await tx
      .select({ jobId: inspectionOffers.jobId })
      .from(inspectionOffers)
      .where(eq(inspectionOffers.id, offerId));
    if (!found) throw new NotFoundException();
    const job = await this.lockJob(tx, found.jobId, user);
    const [offer] = await tx
      .select({
        id: inspectionOffers.id,
        proposedById: inspectionOffers.proposedById,
        amountKobo: inspectionOffers.amountKobo,
        note: inspectionOffers.note,
        status: inspectionOffers.status,
        createdAt: inspectionOffers.createdAt,
      })
      .from(inspectionOffers)
      .where(eq(inspectionOffers.id, offerId))
      .for('update');
    if (offer!.proposedById === user.id) {
      throw new ForbiddenException('Wait for the other person to answer your offer.');
    }
    if (offer!.status !== 'PENDING')
      throw new ConflictException('This offer was already answered.');
    this.assertNegotiable(job);
    return {
      offer: {
        id: offer!.id,
        amountKobo: offer!.amountKobo,
        note: offer!.note,
        status: offer!.status,
        createdAt: offer!.createdAt,
      },
      job,
    };
  }

  private async limit(user: AuthUser): Promise<void> {
    await enforceLimits(this.redis, [
      { key: `inspection-offer:${user.id}`, max: 20, windowSeconds: 60 * 60 },
    ]);
  }
}

/** "₦2,000" (whole naira, as offers are). */
function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
