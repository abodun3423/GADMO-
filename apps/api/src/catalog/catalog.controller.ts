import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, proCategories, proProfiles, users } from '../db/schema';
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
   * Public: a few of the best-rated verified Pros for the home page. Only a first name
   * and initial, their skills and rating: never contact details or location.
   */
  @Get('pros/top')
  async topPros() {
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        ratingAvg: proProfiles.ratingAvg,
        ratingCount: proProfiles.ratingCount,
      })
      .from(proProfiles)
      .innerJoin(users, eq(users.id, proProfiles.userId))
      .where(
        and(
          eq(proProfiles.verificationStatus, 'APPROVED'),
          eq(users.status, 'ACTIVE'),
          eq(users.role, 'PRO'),
        ),
      )
      .orderBy(desc(proProfiles.ratingAvg), desc(proProfiles.ratingCount), asc(users.createdAt))
      .limit(8);
    if (rows.length === 0) return { pros: [] };
    const skills = await this.db
      .select({ proId: proCategories.proId, name: categories.name, slug: categories.slug })
      .from(proCategories)
      .innerJoin(categories, eq(categories.id, proCategories.categoryId))
      .where(
        inArray(
          proCategories.proId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(categories.name));
    return {
      pros: rows
        .map((r) => ({
          id: r.id,
          name: shortName(r.name),
          ratingAvg: r.ratingAvg,
          ratingCount: r.ratingCount,
          skills: skills.filter((s) => s.proId === r.id).map(({ name, slug }) => ({ name, slug })),
        }))
        .filter((p) => p.skills.length > 0),
    };
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
        bio: proProfiles.bio,
        ratingAvg: proProfiles.ratingAvg,
        ratingCount: proProfiles.ratingCount,
        verificationStatus: proProfiles.verificationStatus,
      })
      .from(users)
      .leftJoin(proProfiles, eq(proProfiles.userId, users.id))
      .where(eq(users.id, id))
      .limit(1);
    if (!row) throw new NotFoundException();
    if (row.role !== 'PRO') {
      return { user: { id: row.id, name: row.name, role: row.role } };
    }
    const skills = await this.db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(proCategories)
      .innerJoin(categories, eq(categories.id, proCategories.categoryId))
      .where(eq(proCategories.proId, row.id))
      .orderBy(asc(categories.name));
    return { user: { ...row, skills } };
  }
}

/** "Tunde Bakare" → "Tunde B."; a missing name shows as "GADMO Pro". */
function shortName(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'GADMO Pro';
  return parts.length === 1 ? parts[0]! : `${parts[0]} ${parts.at(-1)![0]!.toUpperCase()}.`;
}
