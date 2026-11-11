import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import { maskContactInfo, type SubmitVerification, submitVerificationSchema } from '@gadmo/shared';
import { createHmac } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import type { FieldCrypto } from '../common/field-crypto';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import {
  auditLogs,
  categories,
  privateFiles,
  proCategories,
  proProfiles,
  skillChecks,
  verifications,
} from '../db/schema';
import { DB, type Db, FIELD_CRYPTO, REDIS } from '../infra/infra.module';
import { sniffImageType } from './images';

const PURPOSE = {
  'id-document': 'ID_DOCUMENT',
  selfie: 'SELFIE',
  attestation: 'ATTESTATION_LETTER',
  certificate: 'CERTIFICATE',
} as const;
const purposePipe = new ZodValidationPipe(
  z.enum(['id-document', 'selfie', 'attestation', 'certificate']),
);

/** The service group whose Pros may add LinkedIn, GitHub and portfolio links. */
const TECH_GROUP = 'tech-digital';

/** A Pro may (re)submit only before a check is under review or after it was sent back. */
const CAN_SUBMIT = new Set(['NOT_STARTED', 'REJECTED', 'NEEDS_INFO']);

/**
 * Stage 1 of a Pro's verification (PRD, founder decision): NIN, ID photo and selfie, plus
 * proof of skill (an attestation letter or a certificate, and where and with whom they
 * trained). Until a KYC provider is connected, GADMO staff review it by hand. The NIN,
 * photos and trainer's phone are encrypted at rest and are never sent back to the Pro or
 * anyone else through these routes.
 */
@Controller('pro/verification')
@UseGuards(JwtAuthGuard)
@Roles(['PRO'])
export class VerificationController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async status(@CurrentUser() pro: AuthUser) {
    const status = await this.currentStatus(pro.id);
    const [latest] = await this.db
      .select({
        createdAt: verifications.createdAt,
        result: verifications.result,
        reviewNote: verifications.reviewNote,
      })
      .from(verifications)
      .where(eq(verifications.proId, pro.id))
      .orderBy(desc(verifications.createdAt))
      .limit(1);
    // Stage 2: the in-person skill check, once the documents are approved.
    const [visit] = await this.db
      .select({
        result: skillChecks.result,
        scheduledAt: skillChecks.scheduledAt,
        visitPlace: skillChecks.visitPlace,
        note: skillChecks.note,
        checkedAt: skillChecks.checkedAt,
      })
      .from(skillChecks)
      .where(eq(skillChecks.proId, pro.id))
      .orderBy(desc(skillChecks.createdAt))
      .limit(1);
    // A Pro who did not pass the skill check sees the agent's note, not the old document note.
    const failedVisit =
      status === 'REJECTED' &&
      visit?.result === 'FAILED' &&
      latest !== undefined &&
      visit.checkedAt !== null &&
      visit.checkedAt > latest.createdAt;
    const drafts = await this.db
      .select({ purpose: privateFiles.purpose })
      .from(privateFiles)
      .where(and(eq(privateFiles.ownerId, pro.id), isNull(privateFiles.verificationId)));
    return {
      verification: {
        status,
        canSubmit: CAN_SUBMIT.has(status),
        submittedAt: latest?.createdAt ?? null,
        note: failedVisit
          ? visit.note
          : status === 'REJECTED' || status === 'NEEDS_INFO'
            ? (latest?.reviewNote ?? null)
            : null,
        /** Set while the Pro waits for the agent's visit. */
        skillCheck:
          status === 'SKILL_CHECK' && visit?.result === 'PENDING'
            ? { scheduledAt: visit.scheduledAt, visitPlace: visit.visitPlace }
            : null,
        photos: {
          idDocument: drafts.some((d) => d.purpose === 'ID_DOCUMENT'),
          selfie: drafts.some((d) => d.purpose === 'SELFIE'),
          attestation: drafts.some((d) => d.purpose === 'ATTESTATION_LETTER'),
          certificate: drafts.some((d) => d.purpose === 'CERTIFICATE'),
        },
        /** Pros with a tech skill can add LinkedIn, GitHub and portfolio links. */
        techLinks: await this.hasTechSkill(pro.id),
      },
    };
  }

  /** Uploads one photo (raw JPEG, PNG or WebP bytes). A new photo replaces the previous draft. */
  @Put('photos/:purpose')
  @HttpCode(204)
  async upload(
    @CurrentUser() pro: AuthUser,
    @Param('purpose', purposePipe) purpose: keyof typeof PURPOSE,
    @Req() req: Request,
  ): Promise<void> {
    const body: unknown = req.body;
    // Only the raw-image body parser produces a Buffer; JSON, text or form bodies are refused.
    if (typeof body === 'string' || Array.isArray(body) || !Buffer.isBuffer(body)) {
      throw new UnsupportedMediaTypeException('Send a photo (JPEG, PNG or WebP).');
    }
    const bytes: Buffer = body;
    const type = sniffImageType(bytes);
    if (!type) throw new UnsupportedMediaTypeException('Send a photo (JPEG, PNG or WebP).');
    await enforceLimits(this.redis, [
      { key: `kyc-upload:${pro.id}`, max: 30, windowSeconds: 60 * 60 },
    ]);
    await this.assertCanSubmit(pro.id);

    const kind = PURPOSE[purpose];
    await this.db.transaction(async (tx) => {
      await tx
        .delete(privateFiles)
        .where(
          and(
            eq(privateFiles.ownerId, pro.id),
            eq(privateFiles.purpose, kind),
            isNull(privateFiles.verificationId),
          ),
        );
      await tx.insert(privateFiles).values({
        ownerId: pro.id,
        purpose: kind,
        contentType: type,
        byteSize: bytes.length,
        dataEncrypted: this.crypto.encrypt(bytes),
      });
    });
  }

  /** Sends the NIN, the photos and the training details for review. */
  @Post()
  @HttpCode(200)
  async submit(
    @CurrentUser() pro: AuthUser,
    @Body(new ZodValidationPipe(submitVerificationSchema)) body: SubmitVerification,
  ) {
    await enforceLimits(this.redis, [
      { key: `kyc-submit:${pro.id}`, max: 5, windowSeconds: 24 * 60 * 60 },
    ]);
    await this.assertCanSubmit(pro.id);
    // Links are kept only for Pros with a tech skill, and only the ones given.
    const given = Object.entries(body.links ?? {}).filter(([, v]) => v);
    const links =
      given.length > 0 && (await this.hasTechSkill(pro.id)) ? Object.fromEntries(given) : null;

    await this.db.transaction(async (tx) => {
      const drafts = await tx
        .select({ id: privateFiles.id, purpose: privateFiles.purpose })
        .from(privateFiles)
        .where(and(eq(privateFiles.ownerId, pro.id), isNull(privateFiles.verificationId)))
        .for('update');
      const idDocument = drafts.find((d) => d.purpose === 'ID_DOCUMENT');
      const selfie = drafts.find((d) => d.purpose === 'SELFIE');
      const attestation = drafts.find((d) => d.purpose === 'ATTESTATION_LETTER');
      const certificate = drafts.find((d) => d.purpose === 'CERTIFICATE');
      if (!idDocument || !selfie) {
        throw new UnprocessableEntityException('Add a photo of your ID and a selfie first.');
      }
      if (!attestation && !certificate) {
        throw new UnprocessableEntityException(
          'Add a photo of your attestation letter or your certificate first.',
        );
      }

      const [check] = await tx
        .insert(verifications)
        .values({
          proId: pro.id,
          provider: 'manual',
          ninEncrypted: this.crypto.encrypt(body.nin),
          ninHash: this.ninHash(body.nin),
          idDocumentRef: `file:${idDocument.id}`,
          selfieRef: `file:${selfie.id}`,
          attestationRef: attestation ? `file:${attestation.id}` : null,
          certificateRef: certificate ? `file:${certificate.id}` : null,
          trainedAt: maskContactInfo(body.trainedAt).text,
          trainedBy: maskContactInfo(body.trainedBy).text,
          trainerPhoneEncrypted: body.trainerPhone ? this.crypto.encrypt(body.trainerPhone) : null,
          techLinks: links,
          result: 'PENDING',
        })
        .returning({ id: verifications.id });
      await tx
        .update(privateFiles)
        .set({ verificationId: check!.id })
        .where(and(eq(privateFiles.ownerId, pro.id), isNull(privateFiles.verificationId)));
      await tx
        .update(proProfiles)
        .set({ verificationStatus: 'PENDING', isOnline: false })
        .where(eq(proProfiles.userId, pro.id));
      await tx.insert(auditLogs).values({
        actorId: pro.id,
        action: 'VERIFICATION_SUBMITTED',
        target: `verification:${check!.id}`,
      });
    });
    return this.status(pro);
  }

  /** Whether the Pro offers any service in the tech & digital group. */
  private async hasTechSkill(proId: string): Promise<boolean> {
    const group = alias(categories, 'service_group');
    const [row] = await this.db
      .select({ id: categories.id })
      .from(proCategories)
      .innerJoin(categories, eq(categories.id, proCategories.categoryId))
      .innerJoin(group, eq(group.id, categories.parentId))
      .where(and(eq(proCategories.proId, proId), eq(group.slug, TECH_GROUP)))
      .limit(1);
    return Boolean(row);
  }

  /** Keyed hash: the same NIN always gives the same value, but it can't be reversed. */
  private ninHash(nin: string): string {
    return createHmac('sha256', this.env.FIELD_ENCRYPTION_KEY).update(`nin:${nin}`).digest('hex');
  }

  private async currentStatus(proId: string): Promise<string> {
    const [profile] = await this.db
      .select({ status: proProfiles.verificationStatus })
      .from(proProfiles)
      .where(eq(proProfiles.userId, proId));
    return profile?.status ?? 'NOT_STARTED';
  }

  private async assertCanSubmit(proId: string): Promise<void> {
    const status = await this.currentStatus(proId);
    if (!CAN_SUBMIT.has(status)) {
      throw new ConflictException(
        status === 'APPROVED'
          ? 'Your identity is already verified.'
          : status === 'SKILL_CHECK'
            ? 'Your documents are approved. A GADMO agent will visit you to see your work.'
            : 'Your identity check is being reviewed. We’ll let you know.',
      );
    }
  }
}
