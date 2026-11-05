import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { type ChoosePro, chooseProSchema, SCHEDULED_REQUEST_HOURS } from '@gadmo/shared';
import { and, asc, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, jobOffers, jobs, proCategories, proProfiles, users } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';
import { offersAnyOf, withRelated } from '../catalog/related';
import { distanceKmSql, roughKm } from './geo';

const idPipe = new ZodValidationPipe(z.uuid());
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Job = { id: string; categoryId: string; latitude: number; longitude: number };
/** The job's own skill, then related skills (see RELATED in db/categories.ts). */
type Skills = string[];

/**
 * Scheduled jobs (PRD section 5): the customer picks a Pro from the verified Pros nearby
 * who offer the service, and sends the request to one at a time. The Pro accepts or
 * declines from Pro home; if they decline or don't answer in time, the customer picks
 * another. Pros never see a customer's identity or exact location before accepting.
 */
@Controller('jobs/:jobId')
@UseGuards(JwtAuthGuard)
@Roles(['CUSTOMER'])
export class ChooseProController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly alerts: AlertsService,
  ) {}

  /** Pros the customer can choose: verified, active, offering the service, in range. */
  @Get('pros')
  async pros(@CurrentUser() user: AuthUser, @Param('jobId', idPipe) jobId: string) {
    const job = await this.openScheduledJob(this.db, user, jobId);
    const rows = await this.eligible(
      this.db,
      job,
      await withRelated(this.db, [job.categoryId]),
    ).limit(30);
    const skills = rows.length
      ? await this.db
          .select({ proId: proCategories.proId, name: categories.name })
          .from(proCategories)
          .innerJoin(categories, eq(categories.id, proCategories.categoryId))
          .where(
            inArray(
              proCategories.proId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(categories.name))
      : [];
    return {
      pros: rows.map((p) => ({
        ...p,
        distanceKm: roughKm(p.distanceKm),
        skills: skills.filter((s) => s.proId === p.id).map((s) => s.name),
      })),
    };
  }

  /** Sends the job to one chosen Pro. Only one request can be waiting at a time. */
  @Post('requests')
  async request(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(chooseProSchema)) body: ChoosePro,
  ) {
    const result = await this.db.transaction(async (tx) => {
      const job = await this.openScheduledJob(tx, user, jobId, true);
      const [waiting] = await tx
        .select({ id: jobOffers.id })
        .from(jobOffers)
        .where(
          and(
            eq(jobOffers.jobId, jobId),
            eq(jobOffers.status, 'PENDING'),
            sql`${jobOffers.expiresAt} > now()`,
          ),
        );
      if (waiting)
        throw new ConflictException('Your request is already with a Pro. Wait for their answer.');
      // A run-out request no longer blocks choosing someone else.
      await tx
        .update(jobOffers)
        .set({ status: 'EXPIRED' })
        .where(and(eq(jobOffers.jobId, jobId), eq(jobOffers.status, 'PENDING')));

      const [pro] = await this.eligible(
        tx,
        job,
        await withRelated(tx, [job.categoryId]),
        body.proId,
      ).limit(1);
      if (!pro) {
        throw new UnprocessableEntityException(
          'That Pro can’t take this job. Choose one from the list.',
        );
      }
      const [offer] = await tx
        .insert(jobOffers)
        .values({
          jobId,
          proId: pro.id,
          distanceKm: Number(pro.distanceKm),
          // 24 hours to answer, but at the latest an hour before the appointment.
          expiresAt: sql`greatest(
            now() + interval '30 minutes',
            least(now() + make_interval(hours => ${SCHEDULED_REQUEST_HOURS}),
                  (select ${jobs.scheduledAt} from ${jobs} where ${jobs.id} = ${jobId}) - interval '1 hour')
          )`,
        })
        .returning({ id: jobOffers.id, expiresAt: jobOffers.expiresAt });
      return {
        request: { id: offer!.id, proId: pro.id, proName: pro.name, expiresAt: offer!.expiresAt },
      };
    });
    const [job] = await this.db
      .select({ service: categories.name, scheduledAt: jobs.scheduledAt })
      .from(jobs)
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .where(eq(jobs.id, jobId));
    const when = job?.scheduledAt
      ? new Intl.DateTimeFormat('en-NG', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Africa/Lagos',
        }).format(job.scheduledAt)
      : 'soon';
    this.alerts.send(
      result.request.proId,
      {
        title: 'New booking request',
        body: `A customer chose you for ${job?.service ?? 'a job'} on ${when}. Accept or decline in GADMO.`,
        url: '/pro',
        tag: `request-${jobId}`,
      },
      { sms: true },
    );
    return result;
  }

  private async openScheduledJob(db: Db | Tx, user: AuthUser, jobId: string, lock = false) {
    const query = db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        proId: jobs.proId,
        categoryId: jobs.categoryId,
        latitude: jobs.latitude,
        longitude: jobs.longitude,
      })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.customerId, user.id)));
    const [job] = lock ? await query.for('update') : await query;
    if (!job) throw new NotFoundException();
    if (job.type !== 'SCHEDULED') {
      throw new ConflictException('Emergencies go to the nearest Pro automatically.');
    }
    if (job.status !== 'REQUESTED' || job.proId) {
      throw new ConflictException('A Pro has already taken this job, or it was cancelled.');
    }
    return job;
  }

  /**
   * Verified, active Pros with this skill or a related one whose travel distance covers
   * the job. Pros with the exact skill come first.
   */
  private eligible(db: Db | Tx, job: Job, skills: Skills, onlyProId?: string) {
    const exact = offersAnyOf(db, proProfiles.userId, [job.categoryId]);
    const distance = distanceKmSql(
      proProfiles.latitude,
      proProfiles.longitude,
      job.latitude,
      job.longitude,
    );
    return db
      .select({
        id: proProfiles.userId,
        name: users.name,
        bio: proProfiles.bio,
        ratingAvg: proProfiles.ratingAvg,
        ratingCount: proProfiles.ratingCount,
        isOnline: proProfiles.isOnline,
        distanceKm: distance,
        exactSkill: sql<boolean>`${exact}`,
      })
      .from(proProfiles)
      .innerJoin(users, eq(users.id, proProfiles.userId))
      .where(
        and(
          offersAnyOf(db, proProfiles.userId, skills),
          onlyProId ? eq(proProfiles.userId, onlyProId) : undefined,
          eq(proProfiles.verificationStatus, 'APPROVED'),
          eq(users.status, 'ACTIVE'),
          eq(users.role, 'PRO'),
          sql`${proProfiles.latitude} is not null`,
          sql`${distance} <= ${proProfiles.serviceRadiusKm}`,
          // Not someone who was already asked about this job.
          notExists(
            db
              .select({ one: sql`1` })
              .from(jobOffers)
              .where(and(eq(jobOffers.jobId, job.id), eq(jobOffers.proId, proProfiles.userId))),
          ),
        ),
      )
      .orderBy(sql`${exact} desc`, desc(proProfiles.ratingAvg), asc(distance))
      .$dynamic();
    // Note: callers add .limit() only; another .where() would replace these conditions.
  }
}
