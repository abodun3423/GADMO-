import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  maskContactInfo,
  MAX_WORK_PHOTOS,
  type WorkPhotoQuery,
  workPhotoQuerySchema,
} from '@gadmo/shared';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import type { FieldCrypto } from '../common/field-crypto';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditLogs, privateFiles, proWorkPhotos, users } from '../db/schema';
import { DB, type Db, FIELD_CRYPTO, REDIS } from '../infra/infra.module';
import { sniffImageType } from '../verification/images';

const idPipe = new ZodValidationPipe(z.uuid());

/** A Pro's work photos still on their profile, oldest first. */
export async function liveWorkPhotos(db: Db, proId: string) {
  return db
    .select({ id: proWorkPhotos.id, caption: proWorkPhotos.caption })
    .from(proWorkPhotos)
    .where(and(eq(proWorkPhotos.proId, proId), isNull(proWorkPhotos.removedAt)))
    .orderBy(asc(proWorkPhotos.createdAt));
}

/**
 * Photos of a Pro's past work, on their public profile (PRD; founder decisions, November
 * 2026): up to MAX_WORK_PHOTOS, shown at once, and staff can remove any that break the
 * rules. Photos are resized on the phone (which drops location data), checked to be real
 * images, and stored encrypted like chat photos; only signed-in users can see them.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class WorkPhotosController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
  ) {}

  /** The Pro's own photos. */
  @Get('pro/photos')
  @Roles(['PRO'])
  async mine(@CurrentUser() pro: AuthUser) {
    return { photos: await liveWorkPhotos(this.db, pro.id), max: MAX_WORK_PHOTOS };
  }

  /** Adds a photo (raw JPEG, PNG or WebP bytes), with an optional ?caption=. */
  @Post('pro/photos')
  @Roles(['PRO'])
  async add(
    @CurrentUser() pro: AuthUser,
    @Query(new ZodValidationPipe(workPhotoQuerySchema)) query: WorkPhotoQuery,
    @Req() req: Request,
  ) {
    const bytes: unknown = req.body;
    const type = sniffImageType(bytes);
    if (!type || !Buffer.isBuffer(bytes)) {
      throw new BadRequestException('Send a JPEG, PNG or WebP photo.');
    }
    await enforceLimits(this.redis, [
      { key: `work-photo:${pro.id}`, max: 30, windowSeconds: 60 * 60 },
    ]);
    const caption = query.caption ? maskContactInfo(query.caption).text : null;
    const photo = await this.db.transaction(async (tx) => {
      // One upload at a time per Pro, so the limit can't be passed by sending several at once.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`work-photos:${pro.id}`}))`);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(proWorkPhotos)
        .where(and(eq(proWorkPhotos.proId, pro.id), isNull(proWorkPhotos.removedAt)));
      if ((count?.n ?? 0) >= MAX_WORK_PHOTOS) {
        throw new ConflictException(
          `You can show up to ${MAX_WORK_PHOTOS} photos. Remove one to add another.`,
        );
      }
      const [file] = await tx
        .insert(privateFiles)
        .values({
          ownerId: pro.id,
          purpose: 'WORK_PHOTO',
          contentType: type,
          byteSize: bytes.length,
          dataEncrypted: this.crypto.encrypt(bytes),
        })
        .returning({ id: privateFiles.id });
      const [row] = await tx
        .insert(proWorkPhotos)
        .values({ proId: pro.id, fileId: file!.id, caption })
        .returning({ id: proWorkPhotos.id, caption: proWorkPhotos.caption });
      return row!;
    });
    return { photo };
  }

  /** The Pro takes a photo off their profile. */
  @Delete('pro/photos/:id')
  @Roles(['PRO'])
  @HttpCode(200)
  async remove(@CurrentUser() pro: AuthUser, @Param('id', idPipe) id: string) {
    const [gone] = await this.db
      .update(proWorkPhotos)
      .set({ removedAt: sql`now()`, removedById: pro.id })
      .where(
        and(
          eq(proWorkPhotos.id, id),
          eq(proWorkPhotos.proId, pro.id),
          isNull(proWorkPhotos.removedAt),
        ),
      )
      .returning({ id: proWorkPhotos.id });
    if (!gone) throw new NotFoundException();
    return { photo: { id, removed: true } };
  }

  /** A photo on a Pro's profile, for anyone signed in. Removed photos are gone. */
  @Get('pros/:proId/photos/:id')
  async image(
    @Param('proId', idPipe) proId: string,
    @Param('id', idPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const [file] = await this.db
      .select({ contentType: privateFiles.contentType, data: privateFiles.dataEncrypted })
      .from(proWorkPhotos)
      .innerJoin(privateFiles, eq(privateFiles.id, proWorkPhotos.fileId))
      .where(
        and(
          eq(proWorkPhotos.id, id),
          eq(proWorkPhotos.proId, proId),
          isNull(proWorkPhotos.removedAt),
        ),
      )
      .limit(1);
    if (!file) throw new NotFoundException();
    res
      .status(200)
      .type(file.contentType)
      .set({
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      })
      .send(this.crypto.decrypt(file.data));
  }
}

/** Staff see every new work photo and remove any that break the rules. */
@Controller('admin/work-photos')
@UseGuards(JwtAuthGuard)
@Roles(['ADMIN', 'SUPER_ADMIN'])
export class AdminWorkPhotosController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The newest photos first, with who added them and whether they were removed. */
  @Get()
  async list() {
    const photos = await this.db
      .select({
        id: proWorkPhotos.id,
        proId: proWorkPhotos.proId,
        proName: users.name,
        caption: proWorkPhotos.caption,
        createdAt: proWorkPhotos.createdAt,
        removedAt: proWorkPhotos.removedAt,
      })
      .from(proWorkPhotos)
      .innerJoin(users, eq(users.id, proWorkPhotos.proId))
      .orderBy(desc(proWorkPhotos.createdAt))
      .limit(60);
    return { photos };
  }

  @Post(':id/remove')
  @HttpCode(200)
  async remove(@CurrentUser() staff: AuthUser, @Param('id', idPipe) id: string) {
    return this.db.transaction(async (tx) => {
      const [gone] = await tx
        .update(proWorkPhotos)
        .set({ removedAt: sql`now()`, removedById: staff.id })
        .where(and(eq(proWorkPhotos.id, id), isNull(proWorkPhotos.removedAt)))
        .returning({ id: proWorkPhotos.id, proId: proWorkPhotos.proId });
      if (!gone) throw new NotFoundException();
      await tx.insert(auditLogs).values({
        actorId: staff.id,
        action: 'WORK_PHOTO_REMOVED',
        target: `user:${gone.proId}`,
        metadata: { photoId: id },
      });
      return { photo: { id, removed: true } };
    });
  }
}
