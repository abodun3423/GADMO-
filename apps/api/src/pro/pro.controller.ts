import {
  Body,
  Controller,
  Get,
  Inject,
  Put,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { maskContactInfo, type ProProfileInput, proProfileSchema } from '@gadmo/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, proCategories, proProfiles } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';

/** A Pro's own profile. Routes carry no user id: a Pro only ever sees or edits their own. */
@Controller('pro')
@UseGuards(JwtAuthGuard)
@Roles(['PRO'])
export class ProController {
  constructor(@Inject(DB) private readonly db: Db) {}

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
