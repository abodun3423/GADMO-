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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  maskContactInfo,
  normalizeNigerianPhone,
  type UserStatusChange,
  userStatusChangeSchema,
} from '@gadmo/shared';
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { OtpService } from '../auth/otp.service';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  auditLogs,
  categories,
  jobs,
  proCategories,
  proProfiles,
  refreshTokens,
  users,
  verifications,
} from '../db/schema';
import { DB, type Db } from '../infra/infra.module';

const idPipe = new ZodValidationPipe(z.uuid());
const PAGE = 50;

const usersQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    role: z.enum(['CUSTOMER', 'PRO', 'ADMIN', 'SUPER_ADMIN']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .strict();
type UsersQuery = z.infer<typeof usersQuery>;

const JOB_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'INSPECTION_PAID',
  'QUOTED',
  'QUOTE_ACCEPTED',
  'IN_PROGRESS',
  'DONE_AWAITING_PAYMENT',
  'BALANCE_HELD',
  'COMPLETED',
  'CASH_COMPLETED',
  'DISPUTED',
  'CANCELLED',
] as const;
const jobsQuery = z
  .object({
    status: z.enum(JOB_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .strict();
type JobsQuery = z.infer<typeof jobsQuery>;

const STAFF = new Set(['ADMIN', 'SUPER_ADMIN']);

/**
 * GADMO staff: the overview, every account (search, suspend, ban) and every job
 * (PRD: "Users and jobs: search, suspend, ban"). Staff only; status changes are
 * audit-logged with a reason and sign the account out everywhere.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles(['ADMIN', 'SUPER_ADMIN'])
export class AdminUsersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly otp: OtpService,
  ) {}

  @Get('overview')
  async overview() {
    const byRole = await this.db
      .select({ role: users.role, n: count() })
      .from(users)
      .groupBy(users.role);
    const [pros] = await this.db
      .select({
        verified: sql<number>`count(*) filter (where ${proProfiles.verificationStatus} = 'APPROVED')::int`,
        online: sql<number>`count(*) filter (where ${proProfiles.isOnline})::int`,
        waiting: sql<number>`count(*) filter (where ${proProfiles.verificationStatus} = 'PENDING')::int`,
      })
      .from(proProfiles);
    const byStatus = await this.db
      .select({ status: jobs.status, n: count() })
      .from(jobs)
      .groupBy(jobs.status);
    const [today] = await this.db
      .select({ n: count() })
      .from(jobs)
      .where(
        sql`${jobs.createdAt} >= date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'`,
      );
    const roleCount = (r: string) => byRole.find((x) => x.role === r)?.n ?? 0;
    return {
      overview: {
        customers: roleCount('CUSTOMER'),
        pros: roleCount('PRO'),
        staff: roleCount('ADMIN') + roleCount('SUPER_ADMIN'),
        prosVerified: pros?.verified ?? 0,
        prosOnline: pros?.online ?? 0,
        checksWaiting: pros?.waiting ?? 0,
        jobsToday: today?.n ?? 0,
        jobsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s.n])),
      },
    };
  }

  /** Accounts, newest first. `q` matches a name or a phone number (any format). */
  @Get('users')
  async list(@Query(new ZodValidationPipe(usersQuery)) query: UsersQuery) {
    const filters: (SQL | undefined)[] = [
      query.role ? eq(users.role, query.role) : undefined,
      query.status ? eq(users.status, query.status) : undefined,
    ];
    if (query.q) {
      const phone = normalizeNigerianPhone(query.q);
      const digits = query.q.replace(/\D/g, '');
      filters.push(
        or(
          ilike(users.name, `%${escapeLike(query.q)}%`),
          phone ? eq(users.phone, phone) : undefined,
          digits.length >= 4 ? ilike(users.phone, `%${digits.replace(/^0/, '')}%`) : undefined,
          ilike(users.email, `%${escapeLike(query.q)}%`),
        ),
      );
    }
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        role: users.role,
        status: users.status,
        chatFlags: users.chatFlags,
        createdAt: users.createdAt,
        verificationStatus: proProfiles.verificationStatus,
        isOnline: proProfiles.isOnline,
      })
      .from(users)
      .leftJoin(proProfiles, eq(proProfiles.userId, users.id))
      .where(and(...filters))
      .orderBy(desc(users.createdAt))
      .limit(PAGE + 1)
      .offset((query.page - 1) * PAGE);
    return { users: rows.slice(0, PAGE), hasMore: rows.length > PAGE };
  }

  @Get('users/:id')
  async detail(@Param('id', idPipe) id: string) {
    const [user] = await this.db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        email: users.email,
        role: users.role,
        status: users.status,
        chatFlags: users.chatFlags,
        deletionRequestedAt: users.deletionRequestedAt,
        createdAt: users.createdAt,
        hasProfile: proProfiles.userId,
        bio: proProfiles.bio,
        serviceRadiusKm: proProfiles.serviceRadiusKm,
        isOnline: proProfiles.isOnline,
        verificationStatus: proProfiles.verificationStatus,
        ratingAvg: proProfiles.ratingAvg,
        ratingCount: proProfiles.ratingCount,
      })
      .from(users)
      .leftJoin(proProfiles, eq(proProfiles.userId, users.id))
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw new NotFoundException();

    const skills = await this.db
      .select({ name: categories.name })
      .from(proCategories)
      .innerJoin(categories, eq(categories.id, proCategories.categoryId))
      .where(eq(proCategories.proId, id))
      .orderBy(asc(categories.name));
    const [latestCheck] = await this.db
      .select({ id: verifications.id, result: verifications.result })
      .from(verifications)
      .where(eq(verifications.proId, id))
      .orderBy(desc(verifications.createdAt))
      .limit(1);
    const recentJobs = await this.jobRows(or(eq(jobs.customerId, id), eq(jobs.proId, id)), 10, 0);
    const history = await this.db
      .select({
        action: auditLogs.action,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(and(eq(auditLogs.target, `user:${id}`), eq(auditLogs.action, 'USER_STATUS_CHANGED')))
      .orderBy(desc(auditLogs.createdAt))
      .limit(20);

    const {
      hasProfile,
      bio,
      serviceRadiusKm,
      isOnline,
      verificationStatus,
      ratingAvg,
      ratingCount,
      ...account
    } = user;
    return {
      user: {
        ...account,
        pro:
          account.role === 'PRO' && hasProfile
            ? { bio, serviceRadiusKm, isOnline, verificationStatus, ratingAvg, ratingCount }
            : null,
        skills: skills.map((s) => s.name),
        latestCheck: latestCheck ?? null,
        recentJobs,
        statusHistory: history,
      },
    };
  }

  /**
   * Suspend, ban or reactivate. Takes effect on the account's next request (the auth
   * guard re-reads status) and signs it out everywhere. Staff can't change their own
   * account, and only a super-admin can change another staff account.
   */
  /** Support: a person locked out by the sign-in code limits can ask for a code again now. */
  @Post('users/:id/reset-sign-in')
  @HttpCode(200)
  async resetSignIn(@CurrentUser() staff: AuthUser, @Param('id', idPipe) id: string) {
    const [user] = await this.db.select({ phone: users.phone }).from(users).where(eq(users.id, id));
    if (!user) throw new NotFoundException();
    await this.otp.resetLimits(user.phone);
    await this.db.insert(auditLogs).values({
      actorId: staff.id,
      action: 'SIGN_IN_LIMITS_RESET',
      target: `user:${id}`,
    });
    return { ok: true };
  }

  @Post('users/:id/status')
  @HttpCode(200)
  async setStatus(
    @CurrentUser() staff: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(userStatusChangeSchema)) body: UserStatusChange,
  ) {
    if (id === staff.id) throw new ForbiddenException('You can’t change your own account.');
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id, role: users.role, status: users.status })
        .from(users)
        .where(eq(users.id, id))
        .for('update');
      if (!user) throw new NotFoundException();
      if (STAFF.has(user.role) && staff.role !== 'SUPER_ADMIN') {
        throw new ForbiddenException('Only a super-admin can change a staff account.');
      }
      if (user.status === body.status) {
        throw new ConflictException(`This account is already ${body.status.toLowerCase()}.`);
      }
      await tx.update(users).set({ status: body.status }).where(eq(users.id, id));
      if (body.status !== 'ACTIVE') {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
        await tx.update(proProfiles).set({ isOnline: false }).where(eq(proProfiles.userId, id));
      }
      await tx.insert(auditLogs).values({
        actorId: staff.id,
        action: 'USER_STATUS_CHANGED',
        target: `user:${id}`,
        metadata: {
          from: user.status,
          to: body.status,
          reason: maskContactInfo(body.reason).text,
        },
      });
      return { user: { id, status: body.status } };
    });
  }

  @Get('jobs')
  async jobsList(@Query(new ZodValidationPipe(jobsQuery)) query: JobsQuery) {
    const rows = await this.jobRows(
      query.status ? eq(jobs.status, query.status) : undefined,
      PAGE + 1,
      (query.page - 1) * PAGE,
    );
    return { jobs: rows.slice(0, PAGE), hasMore: rows.length > PAGE };
  }

  private async jobRows(where: SQL | undefined, limit: number, offset: number) {
    const customer = alias(users, 'customer');
    const pro = alias(users, 'pro');
    const rows = await this.db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        description: jobs.description,
        serviceName: categories.name,
        customerId: jobs.customerId,
        customerName: customer.name,
        proId: jobs.proId,
        proName: pro.name,
        inspectionFeeKobo: jobs.inspectionFeeKobo,
        scheduledAt: jobs.scheduledAt,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .innerJoin(customer, eq(customer.id, jobs.customerId))
      .leftJoin(pro, eq(pro.id, jobs.proId))
      .where(where)
      .orderBy(desc(jobs.createdAt))
      .limit(limit)
      .offset(offset);
    return rows;
  }
}

/** Treat % and _ in a search as plain characters. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
