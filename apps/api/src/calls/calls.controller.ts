import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CALL_RING_SECONDS, type CallSdp, callSdpSchema } from '@gadmo/shared';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { calls, jobs, messages } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';

const idPipe = new ZodValidationPipe(z.uuid());
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Call = typeof calls.$inferSelect;

/** A live call whose other side hasn't checked in for this long has dropped. */
const SILENT_SECONDS = 30;

/**
 * In-app voice calls (founder decision: internet calls first, phone calls later). Only the
 * job's customer and Pro, once the chat is open, and never showing phone numbers. GADMO
 * passes the two browsers' connection details; the voice goes browser to browser.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly alerts: AlertsService,
  ) {}

  /** STUN (and TURN, if set up) servers the browser uses to connect the call. */
  @Get('calls/ice-servers')
  iceServers() {
    const stun = this.env.STUN_URLS.split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    const servers: { urls: string[]; username?: string; credential?: string }[] = [];
    if (stun.length) servers.push({ urls: stun });
    if (this.env.TURN_URLS) {
      servers.push({
        urls: this.env.TURN_URLS.split(',').map((u) => u.trim()),
        username: this.env.TURN_USERNAME,
        credential: this.env.TURN_CREDENTIAL,
      });
    }
    return { iceServers: servers };
  }

  /** The job's live call, if any, as the caller sees it. Also marks the caller as present. */
  @Get('jobs/:jobId/calls/current')
  async current(@CurrentUser() user: AuthUser, @Param('jobId', idPipe) jobId: string) {
    await this.partyJob(this.db, user, jobId);
    const call = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(calls)
        .where(and(eq(calls.jobId, jobId), inArray(calls.status, ['RINGING', 'ACTIVE'])))
        .for('update');
      if (!row) return null;
      const settled = await this.settle(tx, row);
      if (settled.status !== 'RINGING' && settled.status !== 'ACTIVE') return settled;
      const mine = settled.callerId === user.id ? 'callerSeenAt' : 'calleeSeenAt';
      await tx
        .update(calls)
        .set({ [mine]: sql`now()` })
        .where(eq(calls.id, settled.id));
      return settled;
    });
    if (!call) {
      // The last call, so a caller can see it was declined or missed.
      const [last] = await this.db
        .select()
        .from(calls)
        .where(eq(calls.jobId, jobId))
        .orderBy(desc(calls.createdAt))
        .limit(1);
      return { call: last ? this.view(last, user) : null };
    }
    return { call: this.view(call, user) };
  }

  /** Starts a call to the other party: their browser rings for CALL_RING_SECONDS. */
  @Post('jobs/:jobId/calls')
  async start(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(callSdpSchema)) body: CallSdp,
  ) {
    await enforceLimits(this.redis, [{ key: `call:${user.id}`, max: 20, windowSeconds: 60 * 60 }]);
    const { call, job } = await this.db.transaction(async (tx) => {
      const job = await this.partyJob(tx, user, jobId, true);
      if (!job.proId || job.status === 'CANCELLED') {
        throw new ConflictException('Calls open when a Pro accepts the job.');
      }
      const [live] = await tx
        .select()
        .from(calls)
        .where(and(eq(calls.jobId, jobId), inArray(calls.status, ['RINGING', 'ACTIVE'])));
      if (live && ['RINGING', 'ACTIVE'].includes((await this.settle(tx, live)).status)) {
        throw new ConflictException('There is already a call on this job.');
      }
      const calleeId = job.customerId === user.id ? job.proId : job.customerId;
      const [call] = await tx
        .insert(calls)
        .values({ jobId, callerId: user.id, calleeId, offerSdp: body.sdp })
        .returning();
      return { call: call!, job };
    });
    this.alerts.send(call.calleeId, {
      title: `Incoming call from your ${job.customerId === user.id ? 'customer' : 'Pro'}`,
      body: 'Open GADMO to answer.',
      url: `/jobs/${jobId}`,
      tag: `call-${call.id}`,
    });
    return { call: this.view(call, user) };
  }

  @Post('calls/:id/answer')
  @HttpCode(200)
  async answer(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(callSdpSchema)) body: CallSdp,
  ) {
    return this.db.transaction(async (tx) => {
      const call = await this.lockCall(tx, id, user);
      if (call.calleeId !== user.id)
        throw new ForbiddenException('Only the person called answers.');
      if (call.status !== 'RINGING') throw new ConflictException('This call has ended.');
      const [answered] = await tx
        .update(calls)
        .set({
          status: 'ACTIVE',
          answerSdp: body.sdp,
          answeredAt: sql`now()`,
          calleeSeenAt: sql`now()`,
          callerSeenAt: sql`now()`,
        })
        .where(eq(calls.id, id))
        .returning();
      return { call: this.view(answered!, user) };
    });
  }

  @Post('calls/:id/decline')
  @HttpCode(200)
  async decline(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string) {
    return this.db.transaction(async (tx) => {
      const call = await this.lockCall(tx, id, user);
      if (call.calleeId !== user.id)
        throw new ForbiddenException('Only the person called declines.');
      if (call.status !== 'RINGING') return { call: this.view(call, user) };
      const done = await this.finish(tx, call, 'DECLINED');
      return { call: this.view(done, user) };
    });
  }

  /** Hangs up (or, while ringing, cancels). Either side. */
  @Post('calls/:id/end')
  @HttpCode(200)
  async end(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string) {
    return this.db.transaction(async (tx) => {
      const call = await this.lockCall(tx, id, user);
      if (call.status !== 'RINGING' && call.status !== 'ACTIVE') {
        return { call: this.view(call, user) };
      }
      const done = await this.finish(tx, call, call.status === 'RINGING' ? 'MISSED' : 'ENDED');
      return { call: this.view(done, user) };
    });
  }

  /** What one side may see: the other side's connection details, only when needed. */
  private view(call: Call, user: AuthUser) {
    const caller = call.callerId === user.id;
    return {
      id: call.id,
      status: call.status,
      you: caller ? ('CALLER' as const) : ('CALLEE' as const),
      // The callee needs the offer to answer; the caller needs the answer to connect.
      offerSdp: !caller && call.status === 'RINGING' ? call.offerSdp : null,
      answerSdp: caller && call.status === 'ACTIVE' ? call.answerSdp : null,
      createdAt: call.createdAt,
      answeredAt: call.answeredAt,
      endedAt: call.endedAt,
    };
  }

  /** Ends a call that rang out or whose other side went silent. */
  private async settle(tx: Tx, call: Call): Promise<Call> {
    const [ages] = await tx
      .select({
        ringing: sql<number>`extract(epoch from now() - ${calls.createdAt})`,
        callerSilent: sql<number>`extract(epoch from now() - ${calls.callerSeenAt})`,
        calleeSilent: sql<number>`extract(epoch from now() - coalesce(${calls.calleeSeenAt}, ${calls.answeredAt}, now()))`,
      })
      .from(calls)
      .where(eq(calls.id, call.id));
    if (call.status === 'RINGING' && Number(ages!.ringing) > CALL_RING_SECONDS) {
      return this.finish(tx, call, 'MISSED');
    }
    if (
      call.status === 'ACTIVE' &&
      Math.max(Number(ages!.callerSilent), Number(ages!.calleeSilent)) > SILENT_SECONDS
    ) {
      return this.finish(tx, call, 'ENDED');
    }
    return call;
  }

  /** Closes the call and notes it in the chat. */
  private async finish(tx: Tx, call: Call, status: 'ENDED' | 'MISSED' | 'DECLINED') {
    const [done] = await tx
      .update(calls)
      .set({ status, endedAt: sql`now()` })
      .where(eq(calls.id, call.id))
      .returning();
    let body = 'Missed call.';
    if (status === 'DECLINED') body = 'Call declined.';
    if (status === 'ENDED' && done!.answeredAt && done!.endedAt) {
      const secs = Math.max(
        1,
        Math.round((done!.endedAt.getTime() - done!.answeredAt.getTime()) / 1000),
      );
      body = `Call ended · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    }
    await tx
      .insert(messages)
      .values({ jobId: call.jobId, senderId: call.callerId, kind: 'EVENT', body });
    return done!;
  }

  private async lockCall(tx: Tx, id: string, user: AuthUser): Promise<Call> {
    const [call] = await tx
      .select()
      .from(calls)
      .where(and(eq(calls.id, id), or(eq(calls.callerId, user.id), eq(calls.calleeId, user.id))))
      .for('update');
    if (!call) throw new NotFoundException();
    return call;
  }

  /** The job, if the caller is its customer or Pro; otherwise 404. */
  private async partyJob(db: Db | Tx, user: AuthUser, jobId: string, lock = false) {
    const query = db
      .select({
        id: jobs.id,
        customerId: jobs.customerId,
        proId: jobs.proId,
        status: jobs.status,
      })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))));
    const [job] = lock ? await query.for('update') : await query;
    if (!job) throw new NotFoundException();
    return job;
  }
}
