import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { jobOffers, jobs, proProfiles } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';
import { DispatchService } from './dispatch.service';
import { roughKm } from './geo';

const offerId = new ZodValidationPipe(z.uuid());

/**
 * A Pro's emergency offers. Every route is scoped to the signed-in Pro: someone else's
 * offer is a 404, so offer ids cannot be probed.
 */
@Controller('pro/offers')
@UseGuards(JwtAuthGuard)
@Roles(['PRO'])
export class OffersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly dispatch: DispatchService,
  ) {}

  /**
   * Live offers for this Pro: emergencies (2 minutes) and scheduled jobs a customer chose
   * them for (hours), with the seconds left by the server's clock.
   */
  @Get()
  async list(@CurrentUser() pro: AuthUser) {
    const rows = await this.db
      .select({
        id: jobOffers.id,
        distanceKm: jobOffers.distanceKm,
        expiresAt: jobOffers.expiresAt,
        secondsLeft: sql<number>`greatest(0, ceil(extract(epoch from ${jobOffers.expiresAt} - now())))::int`,
        job: {
          id: jobs.id,
          categoryId: jobs.categoryId,
          type: jobs.type,
          description: jobs.description,
          scheduledAt: jobs.scheduledAt,
          createdAt: jobs.createdAt,
        },
      })
      .from(jobOffers)
      .innerJoin(jobs, eq(jobs.id, jobOffers.jobId))
      .where(
        and(
          eq(jobOffers.proId, pro.id),
          eq(jobOffers.status, 'PENDING'),
          sql`${jobOffers.expiresAt} > now()`,
          eq(jobs.status, 'REQUESTED'),
        ),
      )
      .orderBy(asc(jobOffers.expiresAt));
    return { offers: rows.map((o) => ({ ...o, distanceKm: roughKm(o.distanceKm) })) };
  }

  /** Takes the job. Only a live offer to this Pro, for a job nobody else has, can be accepted. */
  @Post(':id/accept')
  @HttpCode(200)
  async accept(@CurrentUser() pro: AuthUser, @Param('id', offerId) id: string) {
    return this.db.transaction(async (tx) => {
      const [offer] = await tx
        .select({
          id: jobOffers.id,
          jobId: jobOffers.jobId,
          status: jobOffers.status,
          live: sql<boolean>`${jobOffers.expiresAt} > now()`,
        })
        .from(jobOffers)
        .where(and(eq(jobOffers.id, id), eq(jobOffers.proId, pro.id)))
        .for('update');
      if (!offer) throw new NotFoundException();

      const [job] = await tx
        .select({ status: jobs.status, proId: jobs.proId })
        .from(jobs)
        .where(eq(jobs.id, offer.jobId))
        .for('update');
      const [profile] = await tx
        .select({ verificationStatus: proProfiles.verificationStatus })
        .from(proProfiles)
        .where(eq(proProfiles.userId, pro.id));

      if (
        offer.status !== 'PENDING' ||
        !offer.live ||
        !job ||
        job.status !== 'REQUESTED' ||
        job.proId !== null ||
        profile?.verificationStatus !== 'APPROVED'
      ) {
        throw new ConflictException('This request is no longer available.');
      }

      await tx
        .update(jobOffers)
        .set({ status: 'ACCEPTED', respondedAt: sql`now()` })
        .where(eq(jobOffers.id, offer.id));
      const [taken] = await tx
        .update(jobs)
        .set({ proId: pro.id, status: 'ACCEPTED' })
        .where(eq(jobs.id, offer.jobId))
        .returning({ id: jobs.id, status: jobs.status, proId: jobs.proId });
      return { job: taken };
    });
  }

  /** Passes on the job; it moves straight on to the next nearest Pro. */
  @Post(':id/decline')
  @HttpCode(200)
  async decline(@CurrentUser() pro: AuthUser, @Param('id', offerId) id: string) {
    const [declined] = await this.db
      .update(jobOffers)
      .set({ status: 'DECLINED', respondedAt: sql`now()` })
      .where(
        and(eq(jobOffers.id, id), eq(jobOffers.proId, pro.id), eq(jobOffers.status, 'PENDING')),
      )
      .returning({ jobId: jobOffers.jobId });
    if (!declined) {
      const [mine] = await this.db
        .select({ id: jobOffers.id })
        .from(jobOffers)
        .where(and(eq(jobOffers.id, id), eq(jobOffers.proId, pro.id)));
      if (!mine) throw new NotFoundException();
      return { ok: true };
    }
    await this.dispatch.advance(declined.jobId);
    return { ok: true };
  }
}
