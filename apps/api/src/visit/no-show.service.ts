import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  formatNaira,
  NO_SHOW_ALERT_COUNT,
  NO_SHOW_ALERT_DAYS,
  VISIT_EXTEND_MINUTES,
} from '@gadmo/shared';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { AlertsService } from '../alerts/alerts.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { jobOffers, jobs, ledgerEntries, messages, noShows, users } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';
import { accountBalance } from '../work/balance.service';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const lagosTime = new Intl.DateTimeFormat('en-NG', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});

/**
 * A Pro who doesn't come after the customer paid the inspection fee (founder decisions,
 * November 2026). Once the visit is due (visitDueAt), the customer can:
 * - wait VISIT_EXTEND_MINUTES longer, while the Pro is on the way; or
 * - cancel: the held fee is refunded to their GADMO wallet at once, the no-show is recorded
 *   against the Pro, and a new request is made for the same work so another Pro can take
 *   it (never the same Pro).
 * Staff can record it too, for a customer who never taps. At NO_SHOW_ALERT_COUNT no-shows
 * in NO_SHOW_ALERT_DAYS, staff are alerted to review the Pro.
 */
@Injectable()
export class NoShowService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly dispatch: DispatchService,
    private readonly alerts: AlertsService,
  ) {}

  /** The customer waits longer for a Pro who is on the way. */
  async waitLonger(jobId: string) {
    const done = await this.db.transaction(async (tx) => {
      const job = await this.lockDue(tx, jobId);
      if (!job.onTheWayAt) {
        throw new ConflictException(
          'Your Pro hasn’t said they are on the way. You can cancel and get your fee back.',
        );
      }
      const [updated] = await tx
        .update(jobs)
        .set({ visitDueAt: sql`now() + make_interval(mins => ${VISIT_EXTEND_MINUTES})` })
        .where(eq(jobs.id, jobId))
        .returning({ visitDueAt: jobs.visitDueAt });
      const until = lagosTime.format(updated!.visitDueAt!);
      await tx.insert(messages).values({
        jobId,
        senderId: job.customerId,
        kind: 'EVENT',
        body: `The customer will wait ${VISIT_EXTEND_MINUTES} more minutes for the Pro, until ${until}.`,
      });
      return { proId: job.proId!, visitDueAt: updated!.visitDueAt!, until };
    });
    this.alerts.send(
      done.proId,
      {
        title: 'Your customer is waiting',
        body: `Your customer will wait until ${done.until}. Arrive and enter their code by then, or they can cancel.`,
        url: `/jobs/${jobId}`,
        tag: `job-${jobId}`,
      },
      { sms: true },
    );
    return { visitDueAt: done.visitDueAt };
  }

  /**
   * Cancels the visit because the Pro didn't come: refunds what GADMO holds for the job to
   * the customer's wallet, records the no-show, and opens a replacement request.
   * `byStaff` skips the waiting time (staff act on the customer's behalf).
   */
  async record(jobId: string, recordedById: string, byStaff = false) {
    const done = await this.db.transaction(async (tx) => {
      const job = byStaff ? await this.lockVisit(tx, jobId) : await this.lockDue(tx, jobId);
      const proId = job.proId!;
      const escrow = `escrow:job:${jobId}`;
      const refund = await accountBalance(tx, escrow);
      if (refund > 0) {
        const txnId = randomUUID();
        await tx.insert(ledgerEntries).values([
          {
            txnId,
            account: escrow,
            debitKobo: refund,
            jobId,
            description: 'Inspection fee refunded: the Pro didn’t come',
          },
          {
            txnId,
            account: `refund-due:customer:${job.customerId}`,
            creditKobo: refund,
            jobId,
            description: 'Refund: the Pro didn’t come',
          },
        ]);
      }
      // The same request again, for another Pro. A scheduled job keeps its time if it is
      // still at least an hour away.
      const [replacement] = await tx
        .insert(jobs)
        .values({
          customerId: job.customerId,
          categoryId: job.categoryId,
          type: job.type,
          description: job.description,
          latitude: job.latitude,
          longitude: job.longitude,
          scheduledAt:
            job.type === 'SCHEDULED'
              ? sql`greatest(${job.scheduledAt ?? new Date()}::timestamptz, now() + interval '1 hour')`
              : null,
        })
        .returning({ id: jobs.id, type: jobs.type, scheduledAt: jobs.scheduledAt });
      // Never offered to the Pro who didn't come (dispatch and "choose a Pro" skip anyone
      // already asked about a job).
      await tx.insert(jobOffers).values({
        jobId: replacement!.id,
        proId,
        status: 'DECLINED',
        distanceKm: 0,
        expiresAt: sql`now()`,
        respondedAt: sql`now()`,
      });
      await tx.insert(noShows).values({
        jobId,
        proId,
        recordedById,
        replacementJobId: replacement!.id,
        refundKobo: refund,
      });
      await tx.update(jobs).set({ status: 'CANCELLED' }).where(eq(jobs.id, jobId));
      await tx.insert(messages).values({
        jobId,
        senderId: recordedById,
        kind: 'EVENT',
        body: `The visit was cancelled because the Pro didn’t arrive in time. ${
          refund > 0 ? `${naira(refund)} was refunded to the customer’s GADMO wallet. ` : ''
        }GADMO is finding the customer another Pro.`,
      });
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(noShows)
        .where(
          and(
            eq(noShows.proId, proId),
            gte(noShows.createdAt, sql`now() - make_interval(days => ${NO_SHOW_ALERT_DAYS})`),
          ),
        );
      return {
        proId,
        customerId: job.customerId,
        refund,
        replacement: replacement!,
        recent: count!.n,
      };
    });

    if (done.replacement.type === 'EMERGENCY') await this.dispatch.advance(done.replacement.id);
    this.alerts.send(
      done.proId,
      {
        title: 'Visit cancelled',
        body: 'The customer’s visit was cancelled because you didn’t arrive in time. It is recorded as a no-show.',
        url: `/jobs/${jobId}`,
        tag: `job-${jobId}`,
      },
      { sms: true },
    );
    if (done.recent >= NO_SHOW_ALERT_COUNT) await this.alertStaff(done.proId, done.recent);
    return {
      refundKobo: done.refund,
      job: { id: jobId, status: 'CANCELLED' },
      replacementJob: done.replacement,
    };
  }

  private async alertStaff(proId: string, recent: number) {
    const staff = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, ['ADMIN', 'SUPER_ADMIN']), eq(users.status, 'ACTIVE')));
    for (const s of staff) {
      this.alerts.send(s.id, {
        title: 'Pro keeps not showing up',
        body: `A Pro has ${recent} no-shows in ${NO_SHOW_ALERT_DAYS} days. Please review their account.`,
        url: `/admin/users/${proId}`,
        tag: `no-shows-${proId}`,
      });
    }
  }

  /** The job, locked, while the Pro's visit is still to happen. */
  private async lockVisit(tx: Tx, jobId: string) {
    const [job] = await tx
      .select({
        customerId: jobs.customerId,
        proId: jobs.proId,
        status: jobs.status,
        categoryId: jobs.categoryId,
        type: jobs.type,
        description: jobs.description,
        latitude: jobs.latitude,
        longitude: jobs.longitude,
        scheduledAt: jobs.scheduledAt,
        onTheWayAt: jobs.onTheWayAt,
        arrivedAt: jobs.arrivedAt,
        visitDueAt: jobs.visitDueAt,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for('update');
    if (!job) throw new NotFoundException();
    if (job.status !== 'INSPECTION_PAID' || job.arrivedAt || !job.proId) {
      throw new ConflictException(
        job.arrivedAt
          ? 'Your Pro has already arrived.'
          : 'This can only be done while you wait for your Pro to arrive.',
      );
    }
    return job;
  }

  /** As lockVisit, once the time for the Pro to arrive has passed. */
  private async lockDue(tx: Tx, jobId: string) {
    const job = await this.lockVisit(tx, jobId);
    if (!job.visitDueAt || job.visitDueAt > new Date()) {
      throw new ConflictException(
        job.visitDueAt
          ? `Your Pro still has until ${lagosTime.format(job.visitDueAt)} to arrive.`
          : 'Your Pro still has time to arrive.',
      );
    }
    return job;
  }
}

function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
