import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  maskContactInfo,
  type ProProfileInput,
  proProfileSchema,
  type SetOnline,
  setOnlineSchema,
} from '@gadmo/shared';
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, jobs, proCategories, proProfiles } from '../db/schema';
import { DispatchService } from '../dispatch/dispatch.service';
import { distanceKmSql, roughKm } from '../dispatch/geo';
import { DB, type Db } from '../infra/infra.module';

/** A Pro's own profile. Routes carry no user id: a Pro only ever sees or edits their own. */
@Controller('pro')
@UseGuards(JwtAuthGuard)
@Roles(['PRO'])
export class ProController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly dispatch: DispatchService,
  ) {}

  @Get('profile')
  async get(@CurrentUser() pro: AuthUser) {
    return { profile: await this.load(pro.id) };
  }

  @Put('profile')
  async update(
    @CurrentUser() pro: AuthUser,
    @Body(new ZodValidationPipe(proProfileSchema)) body: ProProfileInput,
  ) {
    const found = await this.db
      .select({ id: categories.id })
      .from(categories)
      // Only bookable services (not group headings) that are active.
      .where(
        and(
          inArray(categories.id, body.categoryIds),
          eq(categories.active, true),
          isNotNull(categories.parentId),
        ),
      );
    if (found.length !== body.categoryIds.length) {
      throw new UnprocessableEntityException('Unknown skill');
    }

    const bio = body.bio ? maskContactInfo(body.bio).text : null;
    const values = {
      bio,
      latitude: body.latitude,
      longitude: body.longitude,
      serviceRadiusKm: body.serviceRadiusKm,
    };
    await this.db.transaction(async (tx) => {
      await tx
        .insert(proProfiles)
        .values({ userId: pro.id, ...values })
        .onConflictDoUpdate({ target: proProfiles.userId, set: values });
      await tx.delete(proCategories).where(eq(proCategories.proId, pro.id));
      await tx
        .insert(proCategories)
        .values(body.categoryIds.map((categoryId) => ({ proId: pro.id, categoryId })));
    });
    return { profile: await this.load(pro.id) };
  }

  /**
   * Go online or offline. Going online needs a finished identity check (PRD: verified
   * badge, then go online) and a profile with skills and a place. Going offline always works.
   */
  @Post('online')
  @HttpCode(200)
  async setOnline(
    @CurrentUser() pro: AuthUser,
    @Body(new ZodValidationPipe(setOnlineSchema)) body: SetOnline,
  ) {
    if (body.online) {
      const profile = await this.load(pro.id);
      if (profile.verificationStatus !== 'APPROVED') {
        throw new ConflictException('You can go online after your identity check is approved.');
      }
      if (profile.categoryIds.length === 0 || profile.latitude === null) {
        throw new ConflictException('Add your skills and where you work before going online.');
      }
    }
    await this.db
      .update(proProfiles)
      .set({ isOnline: body.online })
      .where(eq(proProfiles.userId, pro.id));
    // A Pro who just came online is offered any open emergency nearby straight away.
    if (body.online) await this.dispatch.tick();
    return { profile: await this.load(pro.id) };
  }

  /**
   * Open scheduled requests near a verified, online Pro, for the services they offer. Customers'
   * exact locations, addresses and identities are not included; only a rounded distance.
   */
  @Get('jobs/nearby')
  async nearby(@CurrentUser() pro: AuthUser) {
    const profile = await this.load(pro.id);
    if (profile.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException('Only verified Pros can see requests.');
    }
    if (!profile.isOnline || profile.latitude === null || profile.longitude === null) {
      return { online: false, jobs: [] };
    }
    if (profile.categoryIds.length === 0) return { online: true, jobs: [] };

    const distanceKm = distanceKmSql(
      profile.latitude,
      profile.longitude,
      jobs.latitude,
      jobs.longitude,
    );

    const rows = await this.db
      .select({
        id: jobs.id,
        categoryId: jobs.categoryId,
        type: jobs.type,
        description: jobs.description,
        scheduledAt: jobs.scheduledAt,
        createdAt: jobs.createdAt,
        distanceKm,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.status, 'REQUESTED'),
          // Emergencies are offered one Pro at a time (see DispatchService), not listed.
          eq(jobs.type, 'SCHEDULED'),
          isNull(jobs.proId),
          inArray(jobs.categoryId, profile.categoryIds),
          // Scheduled jobs whose time has passed are no longer offered.
          or(isNull(jobs.scheduledAt), gt(jobs.scheduledAt, sql`now()`)),
          sql`${distanceKm} <= ${profile.serviceRadiusKm}`,
        ),
      )
      .orderBy(asc(jobs.scheduledAt), asc(distanceKm))
      .limit(50);

    return {
      online: true,
      jobs: rows.map(({ distanceKm: km, ...job }) => ({
        ...job,
        distanceKm: roughKm(km),
      })),
    };
  }

  private async load(proId: string) {
    const [row] = await this.db
      .select({
        bio: proProfiles.bio,
        latitude: proProfiles.latitude,
        longitude: proProfiles.longitude,
        serviceRadiusKm: proProfiles.serviceRadiusKm,
        isOnline: proProfiles.isOnline,
        verificationStatus: proProfiles.verificationStatus,
      })
      .from(proProfiles)
      .where(eq(proProfiles.userId, proId))
      .limit(1);
    const skills = await this.db
      .select({ categoryId: proCategories.categoryId })
      .from(proCategories)
      .where(eq(proCategories.proId, proId));
    return {
      bio: row?.bio ?? '',
      latitude: row?.latitude ?? null,
      longitude: row?.longitude ?? null,
      serviceRadiusKm: row?.serviceRadiusKm ?? 10,
      isOnline: row?.isOnline ?? false,
      verificationStatus: row?.verificationStatus ?? 'NOT_STARTED',
      categoryIds: skills.map((s) => s.categoryId),
    };
  }
}
