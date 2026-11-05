import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  maskContactInfo,
  type SendMessage,
  sendMessageSchema,
  type ShareLocation,
  shareLocationSchema,
} from '@gadmo/shared';
import type { Request, Response } from 'express';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  calls,
  categories,
  inspectionOffers,
  jobs,
  messages,
  privateFiles,
  users,
} from '../db/schema';
import { sniffImageType } from '../verification/images';
import { sniffAudioType } from './media';
import type { FieldCrypto } from '../common/field-crypto';
import { DB, type Db, FIELD_CRYPTO, REDIS } from '../infra/infra.module';

const idPipe = new ZodValidationPipe(z.uuid());
const afterPipe = new ZodValidationPipe(z.iso.datetime({ offset: true }).optional());

/** The raw upload bytes; anything else (a JSON body, a string, an array) is refused. */
function rawBytes(req: Request, message: string): Buffer {
  const body: unknown = req.body;
  if (typeof body === 'string' || Array.isArray(body) || !Buffer.isBuffer(body)) {
    throw new BadRequestException(message);
  }
  return body;
}

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
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
    private readonly alerts: AlertsService,
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
          onTheWayAt: job.onTheWayAt,
          arrivedAt: job.arrivedAt,
          // Only the customer sees the code, and only until the Pro has used it.
          arrivalCode:
            job.customerId === user.id && job.arrivalCodeEncrypted && !job.arrivedAt
              ? this.crypto.decrypt(job.arrivalCodeEncrypted).toString()
              : null,
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
        fileId: messages.attachmentRef,
        latitude: messages.latitude,
        longitude: messages.longitude,
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
      visit: { onTheWayAt: job.onTheWayAt, arrivedAt: job.arrivedAt },
      // A call ringing or in progress, so the chat can show it (details: /calls/current).
      call: await this.liveCall(jobId, user),
    };
  }

  @Post('messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessage,
  ) {
    const job = await this.openChat(user, jobId);
    const masked = maskContactInfo(body.body);
    const preview = masked.text.length > 100 ? `${masked.text.slice(0, 99)}…` : masked.text;
    const message = await this.post(
      user,
      job,
      { body: masked.text, wasMasked: masked.masked },
      preview,
      masked.flagged,
    );
    return { message, notice: masked.masked ? HIDDEN_NOTE : null };
  }

  /** A photo (JPEG, PNG or WebP, resized on the phone first), sent as raw bytes. */
  @Post('messages/photo')
  async photo(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Req() req: Request,
  ) {
    const job = await this.openChat(user, jobId);
    const bytes = rawBytes(req, 'Send a JPEG, PNG or WebP photo.');
    const type = sniffImageType(bytes);
    if (!type) throw new BadRequestException('Send a JPEG, PNG or WebP photo.');
    return { message: await this.attach(user, job, 'CHAT_PHOTO', type, bytes) };
  }

  /** A voice note (WebM, Ogg or MP4 audio, up to a minute), sent as raw bytes. */
  @Post('messages/voice')
  async voice(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Req() req: Request,
  ) {
    const job = await this.openChat(user, jobId);
    const bytes = rawBytes(req, 'Send a voice note recorded in GADMO.');
    const type = sniffAudioType(bytes);
    if (!type) throw new BadRequestException('Send a voice note recorded in GADMO.');
    return { message: await this.attach(user, job, 'CHAT_VOICE', type, bytes) };
  }

  /**
   * A location pin. A customer's exact location is shared only once the inspection fee is
   * paid (PRD), or straight away for services with no inspection fee.
   */
  @Post('messages/location')
  async location(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(shareLocationSchema)) body: ShareLocation,
  ) {
    const job = await this.openChat(user, jobId);
    const customer = job.customerId === user.id;
    if (
      customer &&
      job.inspectionPolicy !== 'NONE' &&
      ['REQUESTED', 'ACCEPTED'].includes(job.status)
    ) {
      throw new ConflictException(
        'You can share your exact location once the inspection fee is paid.',
      );
    }
    const message = await this.post(
      user,
      job,
      {
        kind: 'LOCATION',
        body: 'Shared a location',
        latitude: body.latitude,
        longitude: body.longitude,
      },
      `📍 ${customer ? 'The customer' : 'Your Pro'} shared a location.`,
    );
    return { message };
  }

  /** A photo or voice note from this chat, for its two parties only. */
  @Get('files/:fileId')
  async file(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Param('fileId', idPipe) fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.partyJob(user, jobId);
    const [file] = await this.db
      .select({ contentType: privateFiles.contentType, data: privateFiles.dataEncrypted })
      .from(messages)
      .innerJoin(privateFiles, eq(sql`${privateFiles.id}::text`, messages.attachmentRef))
      .where(and(eq(messages.jobId, jobId), eq(messages.attachmentRef, fileId)))
      .limit(1);
    if (!file) throw new NotFoundException();
    res
      .status(200)
      .type(file.contentType)
      .set({
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      })
      .send(this.crypto.decrypt(file.data));
  }

  private async liveCall(jobId: string, user: AuthUser) {
    const [call] = await this.db
      .select({ id: calls.id, status: calls.status, callerId: calls.callerId })
      .from(calls)
      .where(and(eq(calls.jobId, jobId), inArray(calls.status, ['RINGING', 'ACTIVE'])))
      .limit(1);
    return call
      ? {
          id: call.id,
          status: call.status,
          you: call.callerId === user.id ? ('CALLER' as const) : ('CALLEE' as const),
        }
      : null;
  }

  /** The job if the caller may write in its chat now. */
  private async openChat(user: AuthUser, jobId: string) {
    const job = await this.partyJob(user, jobId);
    if (!job.proId) throw new ConflictException('Chat opens when a Pro accepts the job.');
    if (!this.isOpen(job)) throw new ConflictException('This chat is closed.');
    await enforceLimits(this.redis, [
      { key: `chat:${user.id}`, max: 30, windowSeconds: 60 },
      { key: `chat-day:${user.id}`, max: 1000, windowSeconds: 24 * 60 * 60 },
    ]);
    return job;
  }

  /** Stores an encrypted photo or voice note and posts it in the chat. */
  private async attach(
    user: AuthUser,
    job: Awaited<ReturnType<ChatController['partyJob']>>,
    purpose: 'CHAT_PHOTO' | 'CHAT_VOICE',
    contentType: string,
    bytes: Buffer,
  ) {
    await enforceLimits(this.redis, [
      { key: `chat-media:${user.id}`, max: 60, windowSeconds: 60 * 60 },
    ]);
    const [file] = await this.db
      .insert(privateFiles)
      .values({
        ownerId: user.id,
        purpose,
        contentType,
        byteSize: bytes.length,
        dataEncrypted: this.crypto.encrypt(bytes),
      })
      .returning({ id: privateFiles.id });
    const photo = purpose === 'CHAT_PHOTO';
    return this.post(
      user,
      job,
      {
        kind: photo ? 'PHOTO' : 'VOICE',
        body: photo ? 'Sent a photo' : 'Sent a voice note',
        attachmentRef: file!.id,
      },
      photo ? '📷 Photo' : '🎤 Voice note',
    );
  }

  /** Saves a message and alerts the other party (at most once a minute per chat). */
  private async post(
    user: AuthUser,
    job: Awaited<ReturnType<ChatController['partyJob']>>,
    values: {
      body: string;
      kind?: string;
      wasMasked?: boolean;
      attachmentRef?: string;
      latitude?: number;
      longitude?: number;
    },
    preview: string,
    flagged = false,
  ) {
    const [message] = await this.db.transaction(async (tx) => {
      if (flagged) {
        // Counted toward the sender's review score (PRD: anti-bypass).
        await tx
          .update(users)
          .set({ chatFlags: sql`${users.chatFlags} + 1` })
          .where(eq(users.id, user.id));
      }
      return tx
        .insert(messages)
        .values({ jobId: job.id, senderId: user.id, ...values })
        .returning({
          id: messages.id,
          senderId: messages.senderId,
          kind: messages.kind,
          body: messages.body,
          wasMasked: messages.wasMasked,
          createdAt: messages.createdAt,
          fileId: messages.attachmentRef,
          latitude: messages.latitude,
          longitude: messages.longitude,
        });
    });
    const to = job.customerId === user.id ? job.proId! : job.customerId;
    this.alerts.send(
      to,
      {
        title: `New message from your ${job.customerId === user.id ? 'customer' : 'Pro'}`,
        body: preview,
        url: `/jobs/${job.id}`,
        tag: `chat-${job.id}`,
      },
      // One alert a minute per chat is enough; the chat itself shows the rest.
      { throttle: { key: `chat:${job.id}:${to}`, seconds: 60 } },
    );
    return { ...message!, mine: true, offer: null };
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
        arrivalCodeEncrypted: jobs.arrivalCodeEncrypted,
        onTheWayAt: jobs.onTheWayAt,
        arrivedAt: jobs.arrivedAt,
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
