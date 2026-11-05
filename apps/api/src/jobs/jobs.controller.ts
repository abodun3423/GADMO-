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
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { maskContactInfo } from '@gadmo/shared';
import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, jobOffers, jobs, users } from '../db/schema';
import { DispatchService } from '../dispatch/dispatch.service';
import { DB, type Db } from '../infra/infra.module';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';

const createJobSchema = z
  .object({
    categoryId: z.uuid(),
    type: z.enum(['EMERGENCY', 'SCHEDULED']),
    description: z.string().trim().min(10).max(1000),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    scheduledAt: z.iso.datetime().optional(),
  })
  .strict()
  .refine((v) => v.type === 'EMERGENCY' || v.scheduledAt, {
    message: 'Scheduled jobs need a date and time',
    path: ['scheduledAt'],
  });
type CreateJob = z.infer<typeof createJobSchema>;

/** Fields any party to the job may see. The address is excluded until payment rules allow it. */
const publicJobColumns = {
  id: jobs.id,
  customerId: jobs.customerId,
  proId: jobs.proId,
  categoryId: jobs.categoryId,
  type: jobs.type,
  status: jobs.status,
  description: jobs.description,
  scheduledAt: jobs.scheduledAt,
  createdAt: jobs.createdAt,
};

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly dispatch: DispatchService,
  ) {}

  /**
   * Adds what the customer needs to follow a job: the assigned Pro's name; for an open
   * emergency whether it is with a Pro right now (OFFERED) or waiting for one (NO_PRO_YET;
   * which Pro is never shown); for an open scheduled job whether the request is with the Pro
   * the customer chose (OFFERED, with that Pro's name) or they need to choose (CHOOSE_PRO).
   */
  private async withStatus<
    T extends { id: string; status: string; type: string; proId: string | null },
  >(rows: T[]) {
    const proIds = [...new Set(rows.map((r) => r.proId).filter((id): id is string => !!id))];
    const names = proIds.length
      ? await this.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, proIds))
      : [];
    const open = rows.filter((r) => r.status === 'REQUESTED');
    const offered = open.length
      ? await this.db
          .select({ jobId: jobOffers.jobId, proName: users.name, expiresAt: jobOffers.expiresAt })
          .from(jobOffers)
          .innerJoin(users, eq(users.id, jobOffers.proId))
          .where(
            and(
              inArray(
                jobOffers.jobId,
                open.map((r) => r.id),
              ),
              eq(jobOffers.status, 'PENDING'),
              sql`${jobOffers.expiresAt} > now()`,
            ),
          )
      : [];
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    const live = new Map(offered.map((o) => [o.jobId, o]));
    return rows.map((r) => {
      const offer = live.get(r.id);
      const waiting = r.status === 'REQUESTED';
      return {
        ...r,
        proName: r.proId ? (nameOf.get(r.proId) ?? null) : null,
        dispatch: !waiting
          ? null
          : offer
            ? ('OFFERED' as const)
            : r.type === 'EMERGENCY'
              ? ('NO_PRO_YET' as const)
              : ('CHOOSE_PRO' as const),
        // The customer chose this Pro themselves, so they may see who it is.
        requestedPro:
          waiting && offer && r.type === 'SCHEDULED'
            ? { name: offer.proName, answerBy: offer.expiresAt }
            : null,
      };
    });
  }

  @Post()
  @Roles(['CUSTOMER'])
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createJobSchema)) body: CreateJob,
  ) {
    const [category] = await this.db
      .select({ id: categories.id, emergencyEnabled: categories.emergencyEnabled })
      .from(categories)
      // Groups (no parent) are only headings; a job must name a bookable category.
      .where(
        and(
          eq(categories.id, body.categoryId),
          eq(categories.active, true),
          isNotNull(categories.parentId),
        ),
      )
      .limit(1);
    if (!category) throw new UnprocessableEntityException('Unknown service category');
    if (body.type === 'EMERGENCY' && !category.emergencyEnabled) {
      throw new UnprocessableEntityException('This service does not take emergency requests');
    }

    // Job descriptions follow the chat rule: no contact details.
    const { text: description } = maskContactInfo(body.description);

    const [job] = await this.db
      .insert(jobs)
      .values({
        customerId: user.id,
        categoryId: body.categoryId,
        type: body.type,
        description,
        latitude: body.latitude,
        longitude: body.longitude,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
      })
      .returning(publicJobColumns);
    // Emergencies go straight to the nearest online Pro.
    if (job!.type === 'EMERGENCY') await this.dispatch.advance(job!.id);
    const [withStatus] = await this.withStatus([job!]);
    return { job: withStatus };
  }

  /** Only jobs where the caller is the customer or the assigned Pro. */
  @Get()
  async listMine(@CurrentUser() user: AuthUser) {
    const rows = await this.db
      .select(publicJobColumns)
      .from(jobs)
      .where(or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id)))
      .orderBy(desc(jobs.createdAt))
      .limit(50);
    return { jobs: await this.withStatus(rows) };
  }

  /**
   * Object-level authorization: a job is visible only to its customer, its assigned Pro, or staff.
   * Anyone else gets 404, not 403, so job IDs cannot be probed.
   */
  @Get(':id')
  async getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    const isStaff = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    const [job] = await this.db
      .select(publicJobColumns)
      .from(jobs)
      .where(
        isStaff
          ? eq(jobs.id, id)
          : and(eq(jobs.id, id), or(eq(jobs.customerId, user.id), eq(jobs.proId, user.id))),
      )
      .limit(1);
    if (!job) throw new NotFoundException();
    const [withStatus] = await this.withStatus([job]);
    return { job: withStatus };
  }

  /**
   * The customer cancels a request that no Pro has taken yet. Later stages involve
   * payments and follow the dispute rules instead.
   */
  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(['CUSTOMER'])
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({ status: jobs.status })
        .from(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.customerId, user.id)))
        .for('update');
      if (!job) throw new NotFoundException();
      if (job.status !== 'REQUESTED') {
        throw new ConflictException(
          'A Pro has already taken this job, so it can’t be cancelled here.',
        );
      }
      await tx
        .update(jobOffers)
        .set({ status: 'WITHDRAWN' })
        .where(and(eq(jobOffers.jobId, id), eq(jobOffers.status, 'PENDING')));
      const [cancelled] = await tx
        .update(jobs)
        .set({ status: 'CANCELLED' })
        .where(eq(jobs.id, id))
        .returning(publicJobColumns);
      return { job: { ...cancelled!, proName: null, dispatch: null, requestedPro: null } };
    });
  }
}
