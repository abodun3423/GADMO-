import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { maskContactInfo, type SendMessage, sendMessageSchema } from '@gadmo/shared';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, inspectionOffers, jobs, messages, users } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';

const idPipe = new ZodValidationPipe(z.uuid());
const afterPipe = new ZodValidationPipe(z.iso.datetime({ offset: true }).optional());

const HIDDEN_NOTE =
  'Contact details were hidden. Keep talking in GADMO chat: it’s how your payment and the job stay protected.';

/**
 * Chat between a job's customer and its Pro (PRD: the only way they communicate).
 * Opens once a Pro has accepted. Anyone else gets 404. Every message is masked for
 * phone numbers, emails, links, handles and bank details before it is stored.
 */
@Controller('jobs/:jobId')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** The job, as seen by one of its two parties, with the other party's name. */
  @Get('conversation')
  async conversation(@CurrentUser() user: AuthUser, @Param('jobId', idPipe) jobId: string) {
    const job = await this.partyJob(user, jobId);
    const otherId = job.customerId === user.id ? job.proId : job.customerId;
    const [other] = otherId
      ? await this.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, otherId))
      : [];
    return {
      conversation: {
        job: {
          id: job.id,
          status: job.status,
          type: job.type,
          description: job.description,
          scheduledAt: job.scheduledAt,
          createdAt: job.createdAt,
          serviceName: job.serviceName,
          inspectionPolicy: job.inspectionPolicy,
          inspectionFeeKobo: job.inspectionFeeKobo,
        },
        you: job.customerId === user.id ? 'CUSTOMER' : 'PRO',
        other: other ? { id: other.id, name: other.name } : null,
        open: this.isOpen(job),
      },
    };
  }

  /** Messages oldest first; `after` (an ISO time) returns only newer ones, for polling. */
  @Get('messages')
  async list(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Query('after', afterPipe) after?: string,
  ) {
    const job = await this.partyJob(user, jobId);
    if (!job.proId) throw new ConflictException('Chat opens when a Pro accepts the job.');
    const rows = await this.db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        kind: messages.kind,
        body: messages.body,
        wasMasked: messages.wasMasked,
        createdAt: messages.createdAt,
        offer: {
          id: inspectionOffers.id,
          amountKobo: inspectionOffers.amountKobo,
          note: inspectionOffers.note,
          status: inspectionOffers.status,
        },
      })
      .from(messages)
      .leftJoin(inspectionOffers, eq(inspectionOffers.id, messages.offerId))
      .where(
        and(
          eq(messages.jobId, jobId),
          // Compared at millisecond precision, as the client received the time.
          after
            ? sql`date_trunc('milliseconds', ${messages.createdAt}) > ${new Date(after)}`
            : undefined,
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(200);
    // Offer statuses change after the message is sent, so polling clients also get the
    // current state of every offer in the chat.
    const offers = await this.db
      .select({ id: inspectionOffers.id, status: inspectionOffers.status })
      .from(inspectionOffers)
      .where(eq(inspectionOffers.jobId, jobId));
    return {
      messages: rows.map(({ offer, ...m }) => ({
        ...m,
        mine: m.senderId === user.id,
        offer: offer?.id ? offer : null,
      })),
      offers,
      inspectionFeeKobo: job.inspectionFeeKobo,
      jobStatus: job.status,
    };
  }

  @Post('messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessage,
  ) {
    const job = await this.partyJob(user, jobId);
    if (!job.proId) throw new ConflictException('Chat opens when a Pro accepts the job.');
    if (!this.isOpen(job)) throw new ConflictException('This chat is closed.');
    await enforceLimits(this.redis, [
      { key: `chat:${user.id}`, max: 30, windowSeconds: 60 },
      { key: `chat-day:${user.id}`, max: 1000, windowSeconds: 24 * 60 * 60 },
    ]);

    const masked = maskContactInfo(body.body);
    const [message] = await this.db.transaction(async (tx) => {
      if (masked.flagged) {
        // Counted toward the sender's review score (PRD: anti-bypass).
        await tx
          .update(users)
          .set({ chatFlags: sql`${users.chatFlags} + 1` })
          .where(eq(users.id, user.id));
      }
      return tx
        .insert(messages)
        .values({ jobId, senderId: user.id, body: masked.text, wasMasked: masked.masked })
        .returning({
          id: messages.id,
          senderId: messages.senderId,
          kind: messages.kind,
          body: messages.body,
          wasMasked: messages.wasMasked,
          createdAt: messages.createdAt,
        });
    });
    return {
      message: { ...message!, mine: true, offer: null },
      notice: masked.masked ? HIDDEN_NOTE : null,
    };
  }

  /** The job if the caller is its customer or its assigned Pro; otherwise 404. */
  private async partyJob(user: AuthUser, jobId: string) {
    const [job] = await this.db
      .select({
        id: jobs.id,
        customerId: jobs.customerId,
        proId: jobs.proId,
        status: jobs.status,
        type: jobs.type,
        description: jobs.description,
        scheduledAt: jobs.scheduledAt,
        createdAt: jobs.createdAt,
        inspectionFeeKobo: jobs.inspectionFeeKobo,
        serviceName: categories.name,
        inspectionPolicy: categories.inspectionPolicy,
      })
      .from(jobs)
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .where(and(eq(jobs.id, jobId), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))))
      .limit(1);
    if (!job) throw new NotFoundException();
    return job;
  }

  private isOpen(job: { proId: string | null; status: string }): boolean {
    return job.proId !== null && job.status !== 'CANCELLED';
  }
}
