import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, proProfiles, users } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';

@Controller()
export class CatalogController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Public: the service catalogue for the home screen, as groups with their categories.
   * Inspection fees are not listed — they are agreed in chat per job (max ₦5,000).
   */
  @Get('categories')
  async listCategories() {
    const rows = await this.db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        parentId: categories.parentId,
        emergencyEnabled: categories.emergencyEnabled,
        inspectionPolicy: categories.inspectionPolicy,
        licenceRequired: categories.licenceRequired,
      })
      .from(categories)
      .where(eq(categories.active, true))
      .orderBy(asc(categories.sortOrder), asc(categories.name));

    const groups = rows
      .filter((r) => r.parentId === null)
      .map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        categories: rows
          .filter((r) => r.parentId === g.id)
          .map(({ parentId: _parentId, ...rest }) => rest),
      }));
    return { groups };
  }

  /**
   * Another user's public profile. Contact details (phone, email) are never included —
   * customers and Pros talk only through GADMO chat.
   */
  @Get('users/:id')
  @UseGuards(JwtAuthGuard)
  async publicProfile(@Param('id', new ZodValidationPipe(z.uuid())) id: string) {
    const [row] = await this.db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        ratingAvg: proProfiles.ratingAvg,
        ratingCount: proProfiles.ratingCount,
        verificationStatus: proProfiles.verificationStatus,
      })
      .from(users)
      .leftJoin(proProfiles, eq(proProfiles.userId, users.id))
      .where(eq(users.id, id))
      .limit(1);
    if (!row) throw new NotFoundException();
    return { user: row };
  }
}
