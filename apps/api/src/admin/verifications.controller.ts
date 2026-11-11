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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  maskContactInfo,
  type VerificationDecision,
  verificationDecisionSchema,
} from '@gadmo/shared';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import type { FieldCrypto } from '../common/field-crypto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  auditLogs,
  categories,
  privateFiles,
  proCategories,
  proProfiles,
  skillChecks,
  users,
  verifications,
} from '../db/schema';
import { DB, type Db, FIELD_CRYPTO } from '../infra/infra.module';

const idPipe = new ZodValidationPipe(z.uuid());
const statusPipe = new ZodValidationPipe(
  z.enum(['PENDING', 'APPROVED', 'REJECTED', 'NEEDS_INFO']).default('PENDING'),
);
const PHOTO = {
  'id-document': { purpose: 'ID_DOCUMENT', audit: 'VIEW_ID_PHOTO' },
  selfie: { purpose: 'SELFIE', audit: 'VIEW_SELFIE' },
  attestation: { purpose: 'ATTESTATION_LETTER', audit: 'VIEW_ATTESTATION' },
  certificate: { purpose: 'CERTIFICATE', audit: 'VIEW_CERTIFICATE' },
} as const;
const photoPipe = new ZodValidationPipe(
  z.enum(['id-document', 'selfie', 'attestation', 'certificate']),
);

/**
 * GADMO staff review of Pros' verification documents (PRD: verification review queue):
 * identity, proof of skill and, for tech Pros, their links. Staff only; every look at a NIN,
 * phone or photo and every decision is written to the audit log.
 */
@Controller('admin/verifications')
@UseGuards(JwtAuthGuard)
@Roles(['ADMIN', 'SUPER_ADMIN'])
export class AdminVerificationsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
  ) {}

  /** The queue: oldest first for PENDING (fair order), newest first otherwise. */
  @Get()
  async list(@Query('status', statusPipe) status: string) {
    const rows = await this.db
      .select({
        id: verifications.id,
        proId: verifications.proId,
        proName: users.name,
        result: verifications.result,
        createdAt: verifications.createdAt,
        reviewedAt: verifications.reviewedAt,
        ninHash: verifications.ninHash,
      })
      .from(verifications)
      .innerJoin(users, eq(users.id, verifications.proId))
      .where(eq(verifications.result, status as 'PENDING'))
      .orderBy(status === 'PENDING' ? asc(verifications.createdAt) : desc(verifications.createdAt))
      .limit(100);
    const withFlags = await Promise.all(
      rows.map(async ({ ninHash, ...row }) => ({
        ...row,
        ninUsedElsewhere: await this.otherAccountsWithNin(ninHash, row.proId),
      })),
    );
    return { verifications: withFlags };
  }

  /** One check, with the NIN decrypted for the reviewer (audit-logged). */
  @Get(':id')
  async detail(@CurrentUser() staff: AuthUser, @Param('id', idPipe) id: string) {
    const [row] = await this.db
      .select({
        id: verifications.id,
        proId: verifications.proId,
        proName: users.name,
        proPhone: users.phone,
        proJoinedAt: users.createdAt,
        result: verifications.result,
        ninEncrypted: verifications.ninEncrypted,
        ninHash: verifications.ninHash,
        attestationRef: verifications.attestationRef,
        certificateRef: verifications.certificateRef,
        trainedAt: verifications.trainedAt,
        trainedBy: verifications.trainedBy,
        trainerPhoneEncrypted: verifications.trainerPhoneEncrypted,
        techLinks: verifications.techLinks,
        reviewNote: verifications.reviewNote,
        reviewedAt: verifications.reviewedAt,
        createdAt: verifications.createdAt,
      })
      .from(verifications)
      .innerJoin(users, eq(users.id, verifications.proId))
      .where(eq(verifications.id, id))
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
        id: verifications.id,
        result: verifications.result,
        createdAt: verifications.createdAt,
        reviewNote: verifications.reviewNote,
      })
      .from(verifications)
      .where(and(eq(verifications.proId, row.proId), ne(verifications.id, id)))
      .orderBy(desc(verifications.createdAt));

    await this.audit(staff.id, 'VIEW_NIN', id);
    const {
      ninEncrypted,
      ninHash,
      attestationRef,
      certificateRef,
      trainerPhoneEncrypted,
      ...rest
    } = row;
    return {
      verification: {
        ...rest,
        nin: ninEncrypted ? this.crypto.decrypt(ninEncrypted).toString() : null,
        trainerPhone: trainerPhoneEncrypted
          ? this.crypto.decrypt(trainerPhoneEncrypted).toString()
          : null,
        documents: { attestation: Boolean(attestationRef), certificate: Boolean(certificateRef) },
        ninUsedElsewhere: await this.otherAccountsWithNin(ninHash, row.proId),
        skills: skills.map((s) => s.name),
        history,
      },
    };
  }

  /** A photo, decrypted and streamed to the reviewer only; never cached. */
  @Get(':id/photos/:purpose')
  async photo(
    @CurrentUser() staff: AuthUser,
    @Param('id', idPipe) id: string,
    @Param('purpose', photoPipe) purpose: keyof typeof PHOTO,
    @Res() res: Response,
  ): Promise<void> {
    const [file] = await this.db
      .select({ contentType: privateFiles.contentType, data: privateFiles.dataEncrypted })
      .from(privateFiles)
      .where(
        and(eq(privateFiles.verificationId, id), eq(privateFiles.purpose, PHOTO[purpose].purpose)),
      )
      .limit(1);
    if (!file) throw new NotFoundException();
    await this.audit(staff.id, PHOTO[purpose].audit, id);
    res
      .status(200)
      .type(file.contentType)
      .set({
        'cache-control': 'no-store, private',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      })
      .send(this.crypto.decrypt(file.data));
  }

  /**
   * Approve, reject or ask for more. Only a check that is still pending can be decided.
   * Approved documents do not make the Pro verified yet: they move on to the in-person
   * skill check (founder decision), and only a pass there lets them go online.
   */
  @Post(':id/decision')
  @HttpCode(200)
  async decide(
    @CurrentUser() staff: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(verificationDecisionSchema)) body: VerificationDecision,
  ) {
    const note = body.note ? maskContactInfo(body.note).text : null;
    return this.db.transaction(async (tx) => {
      const [check] = await tx
        .select({ proId: verifications.proId, result: verifications.result })
        .from(verifications)
        .where(eq(verifications.id, id))
        .for('update');
      if (!check) throw new NotFoundException();
      if (check.result !== 'PENDING') {
        throw new ConflictException('This check has already been decided.');
      }
      if (check.proId === staff.id) throw new ConflictException('You can’t review your own check.');

      await tx
        .update(verifications)
        .set({
          result: body.decision,
          reviewedById: staff.id,
          reviewedAt: sql`now()`,
          reviewNote: note,
        })
        .where(eq(verifications.id, id));
      const approved = body.decision === 'APPROVED';
      await tx
        .update(proProfiles)
        .set({ verificationStatus: approved ? 'SKILL_CHECK' : body.decision, isOnline: false })
        .where(eq(proProfiles.userId, check.proId));
      if (approved) {
        await tx.insert(skillChecks).values({ proId: check.proId, verificationId: id });
      }
      await tx.insert(auditLogs).values({
        actorId: staff.id,
        action: 'VERIFICATION_DECISION',
        target: `verification:${id}`,
        metadata: { decision: body.decision, proId: check.proId },
      });
      return { verification: { id, result: body.decision, reviewNote: note } };
    });
  }

  /** How many other Pro accounts sent the same NIN (spotted by its keyed hash). */
  private async otherAccountsWithNin(ninHash: string | null, proId: string): Promise<number> {
    if (!ninHash) return 0;
    const [row] = await this.db
      .select({ n: sql<number>`count(distinct ${verifications.proId})::int` })
      .from(verifications)
      .where(and(eq(verifications.ninHash, ninHash), ne(verifications.proId, proId)));
    return row?.n ?? 0;
  }

  private async audit(actorId: string, action: string, verificationId: string): Promise<void> {
    await this.db
      .insert(auditLogs)
      .values({ actorId, action, target: `verification:${verificationId}` });
  }
}
