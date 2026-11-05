import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EMERGENCY_OFFER_SECONDS } from '@gadmo/shared';
import { and, asc, eq, isNull, lte, notExists, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { AlertsService } from '../alerts/alerts.service';
import { categories, jobOffers, jobs, proProfiles, users } from '../db/schema';
import { offersAnyOf, withRelated } from '../catalog/related';
import { DB, type Db } from '../infra/infra.module';
import { distanceKmSql } from './geo';

/** How often open emergency requests are checked for expired offers and new Pros. */
const TICK_MS = 10_000;

/**
 * A Pro who let an emergency offer run out (didn't answer) may be offered the same job
 * again this long after it ran out, if nobody else has taken it. A Pro who declined is
 * never asked again.
 */
export const EMERGENCY_REOFFER_MINUTES = 10;

/**
 * Emergency dispatch (PRD section 5): an emergency request is offered to one online,
 * verified Pro at a time, nearest first, for EMERGENCY_OFFER_SECONDS. When an offer is
 * declined or runs out, the next nearest Pro is offered it. If nobody is left, the request
 * stays open and is offered to matching Pros as they come online, and again to Pros who
 * missed it, EMERGENCY_REOFFER_MINUTES after their offer ran out (Pros never asked come
 * first).
 *
 * Safe with several API instances: each job is locked while it is advanced, and the
 * database allows one PENDING offer per job. All times come from the database clock.
 */
@Injectable()
export class DispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Dispatch');
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly alerts: AlertsService,
  ) {}

  onModuleInit(): void {
    // Tests drive dispatch explicitly, so no background timer there.
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Advances every open emergency request that has no live offer. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const open = await this.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.status, 'REQUESTED'),
            eq(jobs.type, 'EMERGENCY'),
            isNull(jobs.proId),
            notExists(
              this.db
                .select({ one: sql`1` })
                .from(jobOffers)
                .where(
                  and(
                    eq(jobOffers.jobId, jobs.id),
                    eq(jobOffers.status, 'PENDING'),
                    sql`${jobOffers.expiresAt} > now()`,
                  ),
                ),
            ),
          ),
        )
        .limit(200);
      for (const { id } of open) await this.advance(id);
    } catch (err) {
      this.logger.error('Dispatch tick failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Expires a run-out offer and, if the job has no live offer, offers it to the nearest
   * eligible Pro who hasn't been offered it yet. Does nothing for jobs that are taken,
   * cancelled or not emergencies.
   */
  async advance(jobId: string): Promise<void> {
    let offeredTo: string | null = null;
    try {
      await this.db.transaction(async (tx) => {
        const [job] = await tx
          .select({
            id: jobs.id,
            status: jobs.status,
            type: jobs.type,
            proId: jobs.proId,
            categoryId: jobs.categoryId,
            latitude: jobs.latitude,
            longitude: jobs.longitude,
          })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .for('update');
        if (!job || job.status !== 'REQUESTED' || job.type !== 'EMERGENCY' || job.proId) return;

        await tx
          .update(jobOffers)
          .set({ status: 'EXPIRED' })
          .where(
            and(
              eq(jobOffers.jobId, jobId),
              eq(jobOffers.status, 'PENDING'),
              lte(jobOffers.expiresAt, sql`now()`),
            ),
          );
        const [live] = await tx
          .select({ id: jobOffers.id })
          .from(jobOffers)
          .where(and(eq(jobOffers.jobId, jobId), eq(jobOffers.status, 'PENDING')))
          .limit(1);
        if (live) return;

        const distance = distanceKmSql(
          proProfiles.latitude,
          proProfiles.longitude,
          job.latitude,
          job.longitude,
        );
        // The nearest online Pro with the exact skill or a related one.
        const skills = await withRelated(tx, [job.categoryId]);
        const [next] = await tx
          .select({ proId: proProfiles.userId, distanceKm: distance })
          .from(proProfiles)
          .innerJoin(users, eq(users.id, proProfiles.userId))
          .where(
            and(
              offersAnyOf(tx, proProfiles.userId, skills),
              eq(proProfiles.isOnline, true),
              eq(proProfiles.verificationStatus, 'APPROVED'),
              eq(users.status, 'ACTIVE'),
              eq(users.role, 'PRO'),
              sql`${proProfiles.latitude} is not null`,
              sql`${distance} <= ${proProfiles.serviceRadiusKm}`,
              // Not a Pro who declined, holds or held this job, or who let it run out
              // less than EMERGENCY_REOFFER_MINUTES ago.
              notExists(
                tx
                  .select({ one: sql`1` })
                  .from(jobOffers)
                  .where(
                    and(
                      eq(jobOffers.jobId, jobId),
                      eq(jobOffers.proId, proProfiles.userId),
                      sql`not (${jobOffers.status} = 'EXPIRED' and ${jobOffers.expiresAt} <= now() - make_interval(mins => ${EMERGENCY_REOFFER_MINUTES}))`,
                    ),
                  ),
              ),
              // One live emergency offer per Pro at a time (scheduled requests don't count).
              notExists(
                tx
                  .select({ one: sql`1` })
                  .from(jobOffers)
                  .innerJoin(jobs, eq(jobs.id, jobOffers.jobId))
                  .where(
                    and(
                      eq(jobOffers.proId, proProfiles.userId),
                      eq(jobOffers.status, 'PENDING'),
                      eq(jobs.type, 'EMERGENCY'),
                      sql`${jobOffers.expiresAt} > now()`,
                    ),
                  ),
              ),
            ),
          )
          // Pros never asked about this job first, then the nearest.
          .orderBy(
            sql`exists (select 1 from ${jobOffers} where ${jobOffers.jobId} = ${jobId} and ${jobOffers.proId} = ${proProfiles.userId})`,
            asc(distance),
          )
          .limit(1);
        if (!next) return; // Nobody free nearby: the request stays open.

        await tx.insert(jobOffers).values({
          jobId,
          proId: next.proId,
          distanceKm: Number(next.distanceKm),
          expiresAt: sql`now() + make_interval(secs => ${EMERGENCY_OFFER_SECONDS})`,
        });
        offeredTo = next.proId;
      });
    } catch (err) {
      // Another instance offered the job at the same moment (one-pending index): that's fine.
      if ((err as { code?: string }).code === '23505') return;
      throw err;
    }
    if (offeredTo) {
      const [job] = await this.db
        .select({ service: categories.name })
        .from(jobs)
        .innerJoin(categories, eq(categories.id, jobs.categoryId))
        .where(eq(jobs.id, jobId));
      this.alerts.send(
        offeredTo,
        {
          title: 'Emergency request near you',
          body: `${job?.service ?? 'A customer'}: someone nearby needs help now. Accept within 2 minutes.`,
          url: '/pro',
          tag: `offer-${jobId}`,
        },
        { sms: true },
      );
    }
  }
}
