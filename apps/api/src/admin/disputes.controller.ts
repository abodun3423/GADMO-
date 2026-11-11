import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  COMMISSION_BPS,
  formatNaira,
  maskContactInfo,
  percentOf,
  type ResolveDispute,
  resolveDisputeSchema,
} from '@gadmo/shared';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Response } from 'express';
import { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import type { FieldCrypto } from '../common/field-crypto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditLogs, categories, disputes, jobs, messages, privateFiles, users } from '../db/schema';
import { DB, type Db, FIELD_CRYPTO } from '../infra/infra.module';
import { accountBalance, acceptedQuote, settle } from '../work/balance.service';

const idPipe = new ZodValidationPipe(z.uuid());
const statusPipe = new ZodValidationPipe(z.enum(['open', 'done']).default('open'));

const RESOLVED = {
  PAY_PRO: 'RESOLVED_PRO_PAID',
  REFUND: 'RESOLVED_REFUNDED',
  SPLIT: 'RESOLVED_SPLIT',
  SEND_BACK: 'RESOLVED_REWORK',
} as const;

/**
 * GADMO Guarantee (PRD section 6): staff review a customer's report of poor work, with the
 * chat, quote and photos, then pay the Pro, refund the customer, split the held money, or
 * send the Pro back to fix the work. Commission is 10% of what the Pro receives (founder
 * decision): the whole quote when paid in full, the Pro's share in a split, none after a
 * full refund. Refunds go to the customer's GADMO wallet. Staff only; every look and every
 * decision is audit-logged.
 */
@Controller('admin/disputes')
@UseGuards(JwtAuthGuard)
@Roles(['ADMIN', 'SUPER_ADMIN'])
export class AdminDisputesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
    private readonly alerts: AlertsService,
  ) {}

  /** Open reports, oldest first; or settled ones, newest first. */
  @Get()
  async list(@Query('status', statusPipe) status: 'open' | 'done') {
    const open = status === 'open';
    const customer = alias(users, 'customer');
    const rows = await this.db
      .select({
        id: disputes.id,
        jobId: disputes.jobId,
        status: disputes.status,
        reason: disputes.reason,
        createdAt: disputes.createdAt,
        resolvedAt: disputes.resolvedAt,
        customerName: customer.name,
        serviceName: categories.name,
      })
      .from(disputes)
      .innerJoin(jobs, eq(jobs.id, disputes.jobId))
      .innerJoin(customer, eq(customer.id, jobs.customerId))
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .where(open ? eq(disputes.status, 'OPEN') : ne(disputes.status, 'OPEN'))
      .orderBy(open ? asc(disputes.createdAt) : desc(disputes.resolvedAt))
      .limit(100);
    return { disputes: rows };
  }

  /** One report with everything staff need to decide: the job, quote, money held and chat. */
  @Get(':id')
  async detail(@CurrentUser() staff: AuthUser, @Param('id', idPipe) id: string) {
    const customer = alias(users, 'customer');
    const pro = alias(users, 'pro');
    const [row] = await this.db
      .select({
        id: disputes.id,
        status: disputes.status,
        reason: disputes.reason,
        resolution: disputes.resolution,
        createdAt: disputes.createdAt,
        resolvedAt: disputes.resolvedAt,
        jobId: jobs.id,
        jobStatus: jobs.status,
        description: jobs.description,
        serviceName: categories.name,
        inspectionFeeKobo: jobs.inspectionFeeKobo,
        arrivedAt: jobs.arrivedAt,
        customerId: jobs.customerId,
        customerName: customer.name,
        proId: jobs.proId,
        proName: pro.name,
      })
      .from(disputes)
      .innerJoin(jobs, eq(jobs.id, disputes.jobId))
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .innerJoin(customer, eq(customer.id, jobs.customerId))
      .leftJoin(pro, eq(pro.id, jobs.proId))
      .where(eq(disputes.id, id))
      .limit(1);
    if (!row) throw new NotFoundException();

    const quote = await acceptedQuote(this.db, row.jobId);
    const chat = await this.db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        kind: messages.kind,
        body: messages.body,
        fileId: messages.attachmentRef,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.jobId, row.jobId))
      .orderBy(asc(messages.seq))
      .limit(500);
    await this.audit(staff.id, 'VIEW_DISPUTE', id);
    const { arrivedAt, customerId, proId, ...rest } = row;
    return {
      dispute: {
        ...rest,
        quote,
        inspectionFeeKobo: arrivedAt ? row.inspectionFeeKobo : null,
        heldKobo: await accountBalance(this.db, `escrow:job:${row.jobId}`),
        messages: chat.map(({ senderId, ...m }) => ({
          ...m,
          from: senderId === customerId ? 'CUSTOMER' : senderId === proId ? 'PRO' : 'GADMO',
        })),
      },
    };
  }

  /** A photo or voice note from the disputed job's chat, for staff (audit-logged). */
  @Get(':id/files/:fileId')
  async file(
    @CurrentUser() staff: AuthUser,
    @Param('id', idPipe) id: string,
    @Param('fileId', idPipe) fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    const [file] = await this.db
      .select({ contentType: privateFiles.contentType, data: privateFiles.dataEncrypted })
      .from(disputes)
      .innerJoin(messages, eq(messages.jobId, disputes.jobId))
      .innerJoin(privateFiles, eq(sql`${privateFiles.id}::text`, messages.attachmentRef))
      .where(
        and(
          eq(disputes.id, id),
          eq(messages.attachmentRef, fileId),
          inArray(privateFiles.purpose, ['CHAT_PHOTO', 'CHAT_VOICE']),
        ),
      )
      .limit(1);
    if (!file) throw new NotFoundException();
    await this.audit(staff.id, 'VIEW_DISPUTE_FILE', id);
    res
      .status(200)
      .type(file.contentType)
      .set({
        'cache-control': 'no-store, private',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      })
      .send(this.crypto.decrypt(file.data));
  }

  /** Settles the report. Only an open report on a job still under dispute can be settled. */
  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(
    @CurrentUser() staff: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(resolveDisputeSchema)) body: ResolveDispute,
  ) {
    const note = maskContactInfo(body.note).text;
    const done = await this.db.transaction(async (tx) => {
      const [dispute] = await tx
        .select({ status: disputes.status, jobId: disputes.jobId })
        .from(disputes)
        .where(eq(disputes.id, id))
        .for('update');
      if (!dispute) throw new NotFoundException();
      const [job] = await tx
        .select({ status: jobs.status, proId: jobs.proId, customerId: jobs.customerId })
        .from(jobs)
        .where(eq(jobs.id, dispute.jobId))
        .for('update');
      if (dispute.status !== 'OPEN' || job!.status !== 'DISPUTED' || !job!.proId) {
        throw new ConflictException('This report is already settled.');
      }
      if (staff.id === job!.proId || staff.id === job!.customerId) {
        throw new ConflictException('You can’t settle a report on your own job.');
      }
      const jobId = dispute.jobId;
      const held = await accountBalance(tx, `escrow:job:${jobId}`);
      const quote = await acceptedQuote(tx, jobId);

      let toPro = 0;
      let commission = 0;
      if (body.outcome === 'PAY_PRO') {
        toPro = held;
        commission = quote ? percentOf(quote.amountKobo, COMMISSION_BPS) : 0;
      } else if (body.outcome === 'SPLIT') {
        if (body.proShareKobo! >= held) {
          throw new UnprocessableEntityException(
            `The Pro’s share must be less than the ${naira(held)} held. To pay it all, choose “Pay the Pro”.`,
          );
        }
        toPro = body.proShareKobo!;
        commission = percentOf(toPro, COMMISSION_BPS);
      }

      let refund = 0;
      if (body.outcome === 'SEND_BACK') {
        // The money stays held; the Pro fixes the work and marks the job done again.
        await tx
          .update(jobs)
          .set({ status: 'IN_PROGRESS', doneAt: null })
          .where(eq(jobs.id, jobId));
      } else {
        const moved = await settle(tx, {
          jobId,
          proId: job!.proId,
          customerId: job!.customerId,
          toProKobo: toPro,
          commissionKobo: commission,
        });
        refund = moved.refundKobo;
        await tx.update(jobs).set({ status: 'COMPLETED' }).where(eq(jobs.id, jobId));
      }
      await tx
        .update(disputes)
        .set({
          status: RESOLVED[body.outcome],
          resolution: note,
          resolvedById: staff.id,
          resolvedAt: sql`now()`,
        })
        .where(eq(disputes.id, id));

      const outcomeText = {
        PAY_PRO: `GADMO reviewed the report and paid the Pro the ${naira(held)} held.`,
        REFUND: `GADMO reviewed the report and refunded the ${naira(refund)} held to the customer’s GADMO wallet.`,
        SPLIT: `GADMO reviewed the report and split the payment: ${naira(toPro)} to the Pro, ${naira(refund)} refunded to the customer’s GADMO wallet.`,
        SEND_BACK:
          'GADMO reviewed the report and asked the Pro to come back and fix the work. The payment stays on hold until then.',
      }[body.outcome];
      await tx.insert(messages).values({
        jobId,
        senderId: staff.id,
        kind: 'EVENT',
        body: `${outcomeText} Note from GADMO: ${note}`,
      });
      await tx.insert(auditLogs).values({
        actorId: staff.id,
        action: 'DISPUTE_RESOLVED',
        target: `dispute:${id}`,
        metadata: {
          outcome: body.outcome,
          jobId,
          toProKobo: toPro,
          refundKobo: refund,
          commissionKobo: commission,
        },
      });
      return { jobId, proId: job!.proId, customerId: job!.customerId, outcomeText, toPro, refund };
    });

    for (const who of [done.proId, done.customerId]) {
      this.alerts.send(
        who,
        {
          title: 'Report settled',
          body: done.outcomeText,
          url: `/jobs/${done.jobId}`,
          tag: `job-${done.jobId}`,
        },
        { sms: true },
      );
    }
    return {
      dispute: { id, status: RESOLVED[body.outcome] },
      toProKobo: done.toPro,
      refundKobo: done.refund,
    };
  }

  private async audit(actorId: string, action: string, disputeId: string): Promise<void> {
    await this.db.insert(auditLogs).values({ actorId, action, target: `dispute:${disputeId}` });
  }
}

function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
