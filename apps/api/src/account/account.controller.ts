import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type DeletionRequest,
  deletionRequestSchema,
  maskContactInfo,
  type UpdateProfile,
  updateProfileSchema,
} from '@gadmo/shared';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { clearAuthCookies } from '../auth/cookies';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import {
  auditLogs,
  categories,
  jobs,
  ledgerEntries,
  messages,
  payments,
  proCategories,
  proProfiles,
  refreshTokens,
  reviews,
  users,
} from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';

const ownAccount = {
  id: users.id,
  phone: users.phone,
  name: users.name,
  role: users.role,
  createdAt: users.createdAt,
  deletionRequestedAt: users.deletionRequestedAt,
};

const OPEN = ['REQUESTED'] as const;
const ACTIVE = [
  'ACCEPTED',
  'INSPECTION_PAID',
  'QUOTED',
  'QUOTE_ACCEPTED',
  'IN_PROGRESS',
  'DONE_AWAITING_PAYMENT',
  'BALANCE_HELD',
  'DISPUTED',
] as const;
const DONE = ['COMPLETED', 'CASH_COMPLETED'] as const;

/**
 * The signed-in user's own account. There is no user id in these routes: a user can only
 * ever read or change their own account. The phone number is returned to its owner only.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async get(@CurrentUser() current: AuthUser) {
    const [user] = await this.db
      .select(ownAccount)
      .from(users)
      .where(eq(users.id, current.id))
      .limit(1);
    return { user };
  }

  /** The name is validated to letters only, so it can never carry contact details. */
  @Patch()
  async update(
    @CurrentUser() current: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfile,
  ) {
    // The schema already allows letters only; this second check follows the house rule
    // that all user-written text goes through contact masking before it is stored.
    if (maskContactInfo(body.name).masked) {
      throw new BadRequestException('Names cannot contain contact details');
    }
    const [user] = await this.db
      .update(users)
      .set({ name: body.name })
      .where(eq(users.id, current.id))
      .returning(ownAccount);
    return { user };
  }

  /** Numbers for the account dashboard: jobs, money and (for Pros) standing. */
  @Get('summary')
  async summary(@CurrentUser() current: AuthUser) {
    const pro = current.role === 'PRO';
    const side = pro ? jobs.proId : jobs.customerId;
    const counts = await this.db
      .select({ status: jobs.status, n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(eq(side, current.id))
      .groupBy(jobs.status);
    const count = (statuses: readonly string[]) =>
      counts.filter((c) => statuses.includes(c.status)).reduce((sum, c) => sum + c.n, 0);
    const jobsSummary = {
      open: pro ? 0 : count(OPEN),
      active: count(ACTIVE),
      completed: count(DONE),
      cancelled: count(['CANCELLED']),
    };

    if (pro) {
      const [money] = await this.db
        .select({
          earned: sql<number>`coalesce(sum(${ledgerEntries.creditKobo}), 0)::bigint`,
          balance: sql<number>`coalesce(sum(${ledgerEntries.creditKobo} - ${ledgerEntries.debitKobo}), 0)::bigint`,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.account, `pro:${current.id}`));
      // Money customers have paid for this Pro's jobs that GADMO still holds.
      const [held] = await this.db
        .select({
          kobo: sql<number>`coalesce(sum(${ledgerEntries.creditKobo} - ${ledgerEntries.debitKobo}), 0)::bigint`,
        })
        .from(ledgerEntries)
        .innerJoin(jobs, eq(jobs.id, ledgerEntries.jobId))
        .where(and(eq(jobs.proId, current.id), like(ledgerEntries.account, 'escrow:job:%')));
      const [profile] = await this.db
        .select({
          ratingAvg: proProfiles.ratingAvg,
          ratingCount: proProfiles.ratingCount,
          verificationStatus: proProfiles.verificationStatus,
          isOnline: proProfiles.isOnline,
          skills: sql<number>`(select count(*)::int from ${proCategories} where ${proCategories.proId} = ${proProfiles.userId})`,
        })
        .from(proProfiles)
        .where(eq(proProfiles.userId, current.id));
      return {
        summary: {
          role: 'PRO' as const,
          jobs: jobsSummary,
          money: {
            balanceKobo: Number(money?.balance ?? 0),
            earnedKobo: Number(money?.earned ?? 0),
            heldKobo: Number(held?.kobo ?? 0),
          },
          pro: profile ?? null,
        },
      };
    }

    const [spent] = await this.db
      .select({ kobo: sql<number>`coalesce(sum(${payments.amountKobo}), 0)::bigint` })
      .from(payments)
      .innerJoin(jobs, eq(jobs.id, payments.jobId))
      .where(and(eq(jobs.customerId, current.id), eq(payments.status, 'SUCCEEDED')));
    const [wallet] = await this.db
      .select({
        kobo: sql<number>`coalesce(sum(${ledgerEntries.creditKobo} - ${ledgerEntries.debitKobo}), 0)::bigint`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.account, `refund-due:customer:${current.id}`));
    return {
      summary: {
        role: 'CUSTOMER' as const,
        jobs: jobsSummary,
        money: { balanceKobo: Number(wallet?.kobo ?? 0), spentKobo: Number(spent?.kobo ?? 0) },
        pro: null,
      },
    };
  }

  /** Ends every signed-in session on every device, including this one. */
  @Post('sign-out-everywhere')
  @HttpCode(204)
  async signOutEverywhere(
    @CurrentUser() current: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(refreshTokens.userId, current.id), isNull(refreshTokens.revokedAt)));
    await this.db.insert(auditLogs).values({
      actorId: current.id,
      action: 'SIGN_OUT_EVERYWHERE',
      target: `user:${current.id}`,
    });
    clearAuthCookies(res, this.env.NODE_ENV === 'production');
  }

  /**
   * A copy of the person's own data (Nigeria Data Protection Act: right of access): their
   * account, jobs, their own messages and payments. Never anyone else's contact details.
   */
  @Get('export')
  async export(@CurrentUser() current: AuthUser, @Res() res: Response): Promise<void> {
    await enforceLimits(this.redis, [
      { key: `export:${current.id}`, max: 5, windowSeconds: 24 * 60 * 60 },
    ]);
    const [account] = await this.db.select(ownAccount).from(users).where(eq(users.id, current.id));
    const myJobs = await this.db
      .select({
        id: jobs.id,
        service: categories.name,
        type: jobs.type,
        status: jobs.status,
        description: jobs.description,
        scheduledAt: jobs.scheduledAt,
        createdAt: jobs.createdAt,
        role: sql<string>`case when ${jobs.customerId} = ${current.id} then 'customer' else 'pro' end`,
      })
      .from(jobs)
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .where(or(eq(jobs.customerId, current.id), eq(jobs.proId, current.id)))
      .orderBy(desc(jobs.createdAt));
    const jobIds = myJobs.map((j) => j.id);
    const myMessages = await this.db
      .select({
        jobId: messages.jobId,
        kind: messages.kind,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.senderId, current.id))
      .orderBy(messages.seq);
    const myPayments = jobIds.length
      ? await this.db
          .select({
            jobId: payments.jobId,
            type: payments.type,
            amountKobo: payments.amountKobo,
            status: payments.status,
            createdAt: payments.createdAt,
          })
          .from(payments)
          .innerJoin(jobs, eq(jobs.id, payments.jobId))
          .where(and(inArray(payments.jobId, jobIds), eq(jobs.customerId, current.id)))
      : [];
    const myReviews = await this.db.select().from(reviews).where(eq(reviews.authorId, current.id));
    const body = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        note: 'Your data held by GADMO. Photos and identity documents are not included; ask GADMO support for them.',
        account,
        jobs: myJobs,
        messagesYouSent: myMessages,
        payments: myPayments,
        reviewsYouWrote: myReviews,
      },
      null,
      2,
    );
    res
      .status(200)
      .type('application/json')
      .set({
        'content-disposition': 'attachment; filename="gadmo-my-data.json"',
        'cache-control': 'no-store',
      })
      .send(body);
  }

  /** Asks GADMO to delete the account. Staff settle open jobs and money first. */
  @Post('deletion-request')
  @HttpCode(200)
  async requestDeletion(
    @CurrentUser() current: AuthUser,
    @Body(new ZodValidationPipe(deletionRequestSchema)) body: DeletionRequest,
  ) {
    const reason = body.reason ? maskContactInfo(body.reason).text : null;
    const [user] = await this.db
      .update(users)
      .set({ deletionRequestedAt: sql`coalesce(${users.deletionRequestedAt}, now())` })
      .where(eq(users.id, current.id))
      .returning(ownAccount);
    await this.db.insert(auditLogs).values({
      actorId: current.id,
      action: 'ACCOUNT_DELETION_REQUESTED',
      target: `user:${current.id}`,
      metadata: reason ? { reason } : null,
    });
    return { user };
  }

  @Delete('deletion-request')
  @HttpCode(200)
  async cancelDeletion(@CurrentUser() current: AuthUser) {
    const [user] = await this.db
      .update(users)
      .set({ deletionRequestedAt: null })
      .where(eq(users.id, current.id))
      .returning(ownAccount);
    await this.db.insert(auditLogs).values({
      actorId: current.id,
      action: 'ACCOUNT_DELETION_CANCELLED',
      target: `user:${current.id}`,
    });
    return { user };
  }
}
