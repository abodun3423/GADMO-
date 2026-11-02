import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { users } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';
import { ACCESS_COOKIE } from './cookies';
import { TokenService, type UserRole } from './token.service';

export interface AuthUser {
  id: string;
  role: UserRole;
}

type AuthedRequest = Request & { user?: AuthUser };

/** Restrict a route to some roles: @Roles(['ADMIN']) */
export const Roles = Reflector.createDecorator<UserRole[]>();

/** Exempt a route from the CSRF header check (only for server-to-server webhooks). */
export const SkipCsrf = Reflector.createDecorator<boolean>();

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new UnauthorizedException();
    return user;
  },
);

/**
 * Requires a valid access token (httpOnly cookie, or Bearer header for tools).
 * Role and status are re-read from the database on every request, so a ban or
 * role change takes effect immediately rather than when the token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException();

    const claims = await this.tokens.verifyAccess(token);
    const [user] = await this.db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    if (!user) throw new UnauthorizedException();
    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is not active');

    const allowed = this.reflector.getAllAndOverride(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed && !allowed.includes(user.role)) throw new ForbiddenException();

    req.user = { id: user.id, role: user.role };
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (cookieToken) return cookieToken;
    const header = req.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  }
}

export const CSRF_HEADER = 'x-gadmo-client';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence for cookie auth: browsers will not let another site add a custom
 * header to a cross-site request, so every state-changing call must carry it.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (!UNSAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride(SkipCsrf, [context.getHandler(), context.getClass()]))
      return true;
    if (req.headers[CSRF_HEADER] !== 'web') throw new ForbiddenException('Missing client header');
    return true;
  }
}
