import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { maskContactInfo, type UpdateProfile, updateProfileSchema } from '@gadmo/shared';
import { eq } from 'drizzle-orm';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { users } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';

const ownAccount = { id: users.id, phone: users.phone, name: users.name, role: users.role };

/**
 * The signed-in user's own account. There is no user id in these routes: a user can only
 * ever read or change their own account. The phone number is returned to its owner only.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async get(@CurrentUser() current: AuthUser) {
    const [user] = await this.db
      .select(ownAccount)
      .from(users)
      .where(eq(users.id, current.id))
      .limit(1);
    return { user };
  }

  /** The name is validated to letters only, so it can never carry contact details. */
  @Patch()
  async update(
    @CurrentUser() current: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfile,
  ) {
    // The schema already allows letters only; this second check follows the house rule
    // that all user-written text goes through contact masking before it is stored.
    if (maskContactInfo(body.name).masked) {
      throw new BadRequestException('Names cannot contain contact details');
    }
    const [user] = await this.db
      .update(users)
      .set({ name: body.name })
      .where(eq(users.id, current.id))
      .returning(ownAccount);
    return { user };
  }
}
