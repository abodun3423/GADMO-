import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { maskContactInfo, REVIEW_WINDOW_DAYS, type Review, reviewSchema } from '@gadmo/shared';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, jobs, proProfiles, reviews } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';

const idPipe = new ZodValidationPipe(z.uuid());
const DONE = ['COMPLETED', 'CASH_COMPLETED'];
const WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Ratings after a completed job (founder decisions, November 2026): each side rates the
 * other once, within 14 days, with no edits. The customer's rating of the Pro counts toward
 * the Pro's stars and is shown to customers without the customer's name; the Pro's rating
 * of the customer is seen only by GADMO staff.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Whether the signed-in party can still rate this job, and their rating if given. */
  @Get('jobs/:jobId/review')
  async mine(@CurrentUser() user: AuthUser, @Param('jobId', idPipe) jobId: string) {
    const job = await this.partyJob(user, jobId);
    const [given] = await this.db
      .select({ rating: reviews.rating, comment: reviews.comment, createdAt: reviews.createdAt })
      .from(reviews)
      .where(and(eq(reviews.jobId, jobId), eq(reviews.authorId, user.id)))
      .limit(1);
    const until = reviewUntil(job);
    return {
      review: {
        mine: given ?? null,
        canReview: !given && !!until && until > new Date(),
        until,
        subject: job.customerId === user.id ? 'PRO' : 'CUSTOMER',
      },
    };
  }

  @Post('jobs/:jobId/review')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('jobId', idPipe) jobId: string,
    @Body(new ZodValidationPipe(reviewSchema)) body: Review,
  ) {
    await this.partyJob(user, jobId);
    await enforceLimits(this.redis, [
      { key: `review:${user.id}`, max: 30, windowSeconds: 24 * 60 * 60 },
    ]);
    const comment = body.comment ? maskContactInfo(body.comment).text : null;
    return this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({
          customerId: jobs.customerId,
          proId: jobs.proId,
          status: jobs.status,
          completedAt: jobs.completedAt,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for('update');
      const until = reviewUntil(job!);
      if (!until) throw new ConflictException('You can rate the job once it is complete.');
      if (until <= new Date()) {
        throw new ConflictException(
          `Ratings can be given for ${REVIEW_WINDOW_DAYS} days after a job is complete.`,
        );
      }
      const byCustomer = job!.customerId === user.id;
      const subjectId = byCustomer ? job!.proId! : job!.customerId;
      // Lock the Pro's profile so two ratings at once both count toward the average.
      if (byCustomer) {
        await tx
          .select({ id: proProfiles.userId })
          .from(proProfiles)
          .where(eq(proProfiles.userId, subjectId))
          .for('update');
      }
      const [saved] = await tx
        .insert(reviews)
        .values({ jobId, authorId: user.id, subjectId, rating: body.rating, comment })
        .onConflictDoNothing()
        .returning({
          rating: reviews.rating,
          comment: reviews.comment,
          createdAt: reviews.createdAt,
        });
      if (!saved) throw new ConflictException('You have already rated this job.');
      if (byCustomer) {
        await tx
          .update(proProfiles)
          .set({
            // Only ratings for work they did: a Pro who also books services is rated as a
            // customer too, and those ratings stay with staff.
            ratingAvg: sql`(select coalesce(avg(r.rating), 0) from ${reviews} r join ${jobs} j on j.id = r.job_id where r.subject_id = ${subjectId} and j.pro_id = ${subjectId})`,
            ratingCount: sql`(select count(*) from ${reviews} r join ${jobs} j on j.id = r.job_id where r.subject_id = ${subjectId} and j.pro_id = ${subjectId})`,
          })
          .where(eq(proProfiles.userId, subjectId));
      }
      return { review: { mine: saved, canReview: false, until } };
    });
  }

  /**
   * What customers see about a Pro: the newest ratings and comments, without the names of
   * the customers who gave them.
   */
  @Get('pros/:id/reviews')
  async forPro(@Param('id', idPipe) proId: string) {
    const rows = await this.db
      .select({
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        service: categories.name,
      })
      .from(reviews)
      .innerJoin(jobs, eq(jobs.id, reviews.jobId))
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .where(and(eq(reviews.subjectId, proId), eq(jobs.proId, proId)))
      .orderBy(desc(reviews.createdAt))
      .limit(20);
    return { reviews: rows };
  }

  /** The job, if the user is its customer or its Pro; anyone else gets 404. */
  private async partyJob(user: AuthUser, jobId: string) {
    const [job] = await this.db
      .select({
        customerId: jobs.customerId,
        proId: jobs.proId,
        status: jobs.status,
        completedAt: jobs.completedAt,
      })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))))
      .limit(1);
    if (!job) throw new NotFoundException();
    return job;
  }
}

/** The last moment a completed job can be rated, or null if it isn't complete. */
function reviewUntil(job: {
  status: string;
  proId: string | null;
  completedAt: Date | null;
}): Date | null {
  if (!DONE.includes(job.status) || !job.proId || !job.completedAt) return null;
  return new Date(job.completedAt.getTime() + WINDOW_MS);
}
