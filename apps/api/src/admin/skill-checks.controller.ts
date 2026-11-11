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
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  maskContactInfo,
  type ScheduleSkillCheck,
  scheduleSkillCheckSchema,
  type SkillCheckResult,
  skillCheckResultSchema,
} from '@gadmo/shared';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  auditLogs,
  categories,
  proCategories,
  proProfiles,
  skillChecks,
  users,
  verifications,
} from '../db/schema';
import { DB, type Db } from '../infra/infra.module';

const idPipe = new ZodValidationPipe(z.uuid());
const statusPipe = new ZodValidationPipe(z.enum(['open', 'done']).default('open'));

/** A visit can be booked from an hour ago (recording a visit made today) onwards. */
const PAST_GRACE_MS = 60 * 60 * 1000;

/**
 * Stage 2 of Pro verification (founder decision): after the documents are approved, a
 * GADMO field agent visits the Pro, sees their tools, a short demonstration and past work,
 * and records pass or fail. Only a pass makes the Pro verified. Staff only; every booking
 * and result is written to the audit log.
 */
@Controller('admin/skill-checks')
@UseGuards(JwtAuthGuard)
@Roles(['ADMIN', 'SUPER_ADMIN'])
export class AdminSkillChecksController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Open checks, oldest first (fair order); or finished ones, newest first. */
  @Get()
  async list(@Query('status', statusPipe) status: 'open' | 'done') {
    const open = status === 'open';
    const rows = await this.db
      .select({
        id: skillChecks.id,
        proId: skillChecks.proId,
        proName: users.name,
        result: skillChecks.result,
        scheduledAt: skillChecks.scheduledAt,
        visitPlace: skillChecks.visitPlace,
        checkedAt: skillChecks.checkedAt,
        createdAt: skillChecks.createdAt,
      })
      .from(skillChecks)
      .innerJoin(users, eq(users.id, skillChecks.proId))
      .where(
        open
          ? eq(skillChecks.result, 'PENDING')
          : inArray(skillChecks.result, ['PASSED', 'FAILED']),
      )
      .orderBy(open ? asc(skillChecks.createdAt) : desc(skillChecks.checkedAt))
      .limit(100);
    return { skillChecks: rows };
  }

  /** One check, with what the agent needs for the visit. */
  @Get(':id')
  async detail(@Param('id', idPipe) id: string) {
    const [row] = await this.db
      .select({
        id: skillChecks.id,
        proId: skillChecks.proId,
        proName: users.name,
        proPhone: users.phone,
        verificationId: skillChecks.verificationId,
        result: skillChecks.result,
        scheduledAt: skillChecks.scheduledAt,
        visitPlace: skillChecks.visitPlace,
        note: skillChecks.note,
        checkedAt: skillChecks.checkedAt,
        createdAt: skillChecks.createdAt,
        trainedAt: verifications.trainedAt,
        trainedBy: verifications.trainedBy,
      })
      .from(skillChecks)
      .innerJoin(users, eq(users.id, skillChecks.proId))
      .innerJoin(verifications, eq(verifications.id, skillChecks.verificationId))
      .where(eq(skillChecks.id, id))
      .limit(1);
    if (!row) throw new NotFoundException();

    const skills = await this.db
      .select({ name: categories.name })
      .from(proCategories)
      .innerJoin(categories, eq(categories.id, proCategories.categoryId))
      .where(eq(proCategories.proId, row.proId))
      .orderBy(asc(categories.name));
    const history = await this.db
      .select({
        id: skillChecks.id,
        result: skillChecks.result,
        checkedAt: skillChecks.checkedAt,
        note: skillChecks.note,
      })
      .from(skillChecks)
      .where(and(eq(skillChecks.proId, row.proId), ne(skillChecks.id, id)))
      .orderBy(desc(skillChecks.createdAt));
    return { skillCheck: { ...row, skills: skills.map((s) => s.name), history } };
  }

  /** Books (or moves) the visit. The Pro sees the time and place. */
  @Post(':id/schedule')
  @HttpCode(200)
  async schedule(
    @CurrentUser() staff: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(scheduleSkillCheckSchema)) body: ScheduleSkillCheck,
  ) {
    const when = new Date(body.scheduledAt);
    if (when.getTime() < Date.now() - PAST_GRACE_MS) {
      throw new UnprocessableEntityException('Choose a time that hasn’t passed.');
    }
    const visitPlace = maskContactInfo(body.visitPlace).text;
    return this.db.transaction(async (tx) => {
      const check = await this.openCheck(tx, id, staff.id);
      await tx
        .update(skillChecks)
        .set({ scheduledAt: when, visitPlace, scheduledById: staff.id })
        .where(eq(skillChecks.id, id));
      await tx.insert(auditLogs).values({
        actorId: staff.id,
        action: 'SKILL_CHECK_SCHEDULED',
        target: `skill-check:${id}`,
        metadata: { proId: check.proId, scheduledAt: when.toISOString() },
      });
      return { skillCheck: { id, result: 'PENDING', scheduledAt: when, visitPlace } };
    });
  }

  /** Records pass or fail. A pass makes the Pro verified; a fail sends them back to the start. */
  @Post(':id/result')
  @HttpCode(200)
  async result(
    @CurrentUser() staff: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(skillCheckResultSchema)) body: SkillCheckResult,
  ) {
    const note = maskContactInfo(body.note).text;
    return this.db.transaction(async (tx) => {
      const check = await this.openCheck(tx, id, staff.id);
      await tx
        .update(skillChecks)
        .set({ result: body.result, note, checkedById: staff.id, checkedAt: sql`now()` })
        .where(eq(skillChecks.id, id));
      const passed = body.result === 'PASSED';
      await tx
        .update(proProfiles)
        .set({ verificationStatus: passed ? 'APPROVED' : 'REJECTED', isOnline: false })
        .where(
          and(
            eq(proProfiles.userId, check.proId),
            eq(proProfiles.verificationStatus, 'SKILL_CHECK'),
          ),
        );
      await tx.insert(auditLogs).values({
        actorId: staff.id,
        action: 'SKILL_CHECK_RESULT',
        target: `skill-check:${id}`,
        metadata: { result: body.result, proId: check.proId },
      });
      return { skillCheck: { id, result: body.result, note } };
    });
  }

  /** The check, locked for this change; only an open check can change, and not by its own Pro. */
  private async openCheck(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    id: string,
    staffId: string,
  ): Promise<{ proId: string }> {
    const [check] = await tx
      .select({ proId: skillChecks.proId, result: skillChecks.result })
      .from(skillChecks)
      .where(eq(skillChecks.id, id))
      .for('update');
    if (!check) throw new NotFoundException();
    if (check.result !== 'PENDING') {
      throw new ConflictException('This skill check is already finished.');
    }
    if (check.proId === staffId) throw new ConflictException('You can’t check yourself.');
    return check;
  }
}
