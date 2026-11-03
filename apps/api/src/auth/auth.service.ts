import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { OtpVerify } from '@gadmo/shared';
import { eq } from 'drizzle-orm';
import { proProfiles, users } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';
import { OtpService } from './otp.service';
import { type SessionKind, TokenService } from './token.service';

export interface Session {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt?: Date;
  user: { id: string; role: string; isNew: boolean };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Verify the code, create the account on first login, and start a session. */
  async verifyAndLogin(input: OtpVerify, userAgent?: string): Promise<Session> {
    const result = await this.otp.verify(input.phone, input.code);
    if (result === 'locked') {
      throw new HttpException(
        'Too many wrong tries. Ask for a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (result !== 'ok') throw new UnauthorizedException('The code is wrong or has expired');

    let isNew = false;
    let [user] = await this.db.select().from(users).where(eq(users.phone, input.phone)).limit(1);

    if (!user) {
      isNew = true;
      // Only CUSTOMER or PRO can be chosen here; admins are created by a super-admin.
      const role = input.role === 'pro' ? 'PRO' : 'CUSTOMER';
      user = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({ phone: input.phone, role })
          .onConflictDoNothing({ target: users.phone })
          .returning();
        const row =
          created ?? (await tx.select().from(users).where(eq(users.phone, input.phone)))[0]!;
        if (created && role === 'PRO') await tx.insert(proProfiles).values({ userId: created.id });
        return row;
      });
    }

    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is not active');
    // Staff never sign in here: they use the staff sign-in (password + phone code).
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      throw new ForbiddenException('GADMO staff sign in on the staff page.');
    }

    return this.startSession(user, isNew, 'app', userAgent);
  }

  async startSession(
    user: { id: string; role: (typeof users.$inferSelect)['role'] },
    isNew: boolean,
    kind: SessionKind,
    userAgent?: string,
  ): Promise<Session> {
    const accessToken = await this.tokens.signAccess({ sub: user.id, role: user.role });
    const refresh = await this.tokens.createRefresh(user.id, userAgent, undefined, kind);
    return {
      accessToken,
      refreshToken: refresh.raw,
      refreshExpiresAt: kind === 'staff' ? refresh.expiresAt : undefined,
      user: { id: user.id, role: user.role, isNew },
    };
  }

  async refresh(rawRefresh: string, userAgent?: string): Promise<Omit<Session, 'user'>> {
    const { userId, refresh, kind } = await this.tokens.rotate(rawRefresh, userAgent);
    const [user] = await this.db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || user.status !== 'ACTIVE') {
      await this.tokens.revokeByRaw(refresh.raw);
      throw new UnauthorizedException();
    }
    const accessToken = await this.tokens.signAccess({ sub: user.id, role: user.role });
    return {
      accessToken,
      refreshToken: refresh.raw,
      refreshExpiresAt: kind === 'staff' ? refresh.expiresAt : undefined,
    };
  }
}
