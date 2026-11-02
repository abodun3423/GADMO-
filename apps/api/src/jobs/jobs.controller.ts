import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { maskContactInfo } from '@gadmo/shared';
import { and, desc, eq, isNotNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, jobs } from '../db/schema';
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
  constructor(@Inject(DB) private readonly db: Db) {}

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
    return { job };
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
    return { jobs: rows };
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
    return { job };
  }
}
