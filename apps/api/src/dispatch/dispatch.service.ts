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
import { jobOffers, jobs, proCategories, proProfiles, users } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';
import { distanceKmSql } from './geo';

/** How often open emergency requests are checked for expired offers and new Pros. */
const TICK_MS = 10_000;

/**
 * Emergency dispatch (PRD section 5): an emergency request is offered to one online,
 * verified Pro at a time, nearest first, for EMERGENCY_OFFER_SECONDS. When an offer is
 * declined or runs out, the next nearest Pro is offered it. If nobody is left, the request
 * stays open and is offered to matching Pros as they come online.
 *
 * Safe with several API instances: each job is locked while it is advanced, and the
 * database allows one PENDING offer per job and one offer per job and Pro. All times
 * come from the database clock.
 */
@Injectable()
export class DispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Dispatch');
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
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
        const [next] = await tx
          .select({ proId: proProfiles.userId, distanceKm: distance })
          .from(proProfiles)
          .innerJoin(users, eq(users.id, proProfiles.userId))
          .innerJoin(
            proCategories,
            and(
              eq(proCategories.proId, proProfiles.userId),
              eq(proCategories.categoryId, job.categoryId),
            ),
          )
          .where(
            and(
              eq(proProfiles.isOnline, true),
              eq(proProfiles.verificationStatus, 'APPROVED'),
              eq(users.status, 'ACTIVE'),
              eq(users.role, 'PRO'),
              sql`${proProfiles.latitude} is not null`,
              sql`${distance} <= ${proProfiles.serviceRadiusKm}`,
              // Never the same Pro twice for one job.
              notExists(
                tx
                  .select({ one: sql`1` })
                  .from(jobOffers)
                  .where(and(eq(jobOffers.jobId, jobId), eq(jobOffers.proId, proProfiles.userId))),
              ),
              // One live emergency offer per Pro at a time.
              notExists(
                tx
                  .select({ one: sql`1` })
                  .from(jobOffers)
                  .where(
                    and(
                      eq(jobOffers.proId, proProfiles.userId),
                      eq(jobOffers.status, 'PENDING'),
                      sql`${jobOffers.expiresAt} > now()`,
                    ),
                  ),
              ),
            ),
          )
          .orderBy(asc(distance))
          .limit(1);
        if (!next) return; // Nobody free nearby: the request stays open.

        await tx.insert(jobOffers).values({
          jobId,
          proId: next.proId,
          distanceKm: Number(next.distanceKm),
          expiresAt: sql`now() + make_interval(secs => ${EMERGENCY_OFFER_SECONDS})`,
        });
      });
    } catch (err) {
      // Another instance offered the job at the same moment (unique index): that's fine.
      if ((err as { code?: string }).code === '23505') return;
      throw err;
    }
  }
}
