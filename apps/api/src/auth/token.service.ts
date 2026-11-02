import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { refreshTokens, users } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const ISSUER = 'gadmo-api';
const AUDIENCE = 'gadmo-web';

export type UserRole = (typeof users.$inferSelect)['role'];

export interface AccessClaims {
  sub: string;
  role: UserRole;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  signAccess(claims: AccessClaims): Promise<string> {
    return this.jwt.signAsync(
      { role: claims.role },
      {
        secret: this.env.JWT_ACCESS_SECRET,
        subject: claims.sub,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithm: 'HS256',
      },
    );
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string; role?: UserRole }>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (!payload.sub || !payload.role) throw new Error('missing claims');
      return { sub: payload.sub, role: payload.role };
    } catch {
      throw new UnauthorizedException();
    }
  }

  /** Opaque random refresh token. Only its SHA-256 hash is stored. */
  async createRefresh(userId: string, userAgent?: string, familyId: string = randomUUID()) {
    const raw = randomBytes(32).toString('base64url');
    const [row] = await this.db
      .insert(refreshTokens)
      .values({
        userId,
        familyId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        userAgent: userAgent?.slice(0, 255),
      })
      .returning({ id: refreshTokens.id });
    return { raw, id: row!.id };
  }

  /**
   * Swap a refresh token for a new one. Presenting an already-used token means it was
   * stolen or replayed, so every token in that login family is revoked.
   */
  async rotate(
    raw: string,
    userAgent?: string,
  ): Promise<{ userId: string; refresh: { raw: string } }> {
    const [current] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(raw)))
      .limit(1);
    if (!current) throw new UnauthorizedException();

    if (current.revokedAt || current.replacedById) {
      await this.revokeFamily(current.familyId);
      throw new UnauthorizedException();
    }
    if (current.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();

    return this.db.transaction(async (tx) => {
      // Claim the token atomically: only one concurrent request can win.
      const claimed = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, current.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (claimed.length === 0) throw new UnauthorizedException();

      const nextRaw = randomBytes(32).toString('base64url');
      const [next] = await tx
        .insert(refreshTokens)
        .values({
          userId: current.userId,
          familyId: current.familyId,
          tokenHash: sha256(nextRaw),
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
          userAgent: userAgent?.slice(0, 255),
        })
        .returning({ id: refreshTokens.id });
      await tx
        .update(refreshTokens)
        .set({ replacedById: next!.id })
        .where(eq(refreshTokens.id, current.id));
      return { userId: current.userId, refresh: { raw: nextRaw } };
    });
  }

  /** Logout: revoke the whole login family of this token. Unknown tokens are ignored. */
  async revokeByRaw(raw: string): Promise<void> {
    const [row] = await this.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(raw)))
      .limit(1);
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}
