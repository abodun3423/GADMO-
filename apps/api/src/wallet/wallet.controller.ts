import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type BankAccountInput,
  bankAccountSchema,
  type WithdrawalInput,
  withdrawalSchema,
} from '@gadmo/shared';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditLogs } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';
import { PAUSE_KEY, WalletService } from './wallet.service';

/** The caller's own wallet: no user id in these routes. */
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@Roles(['CUSTOMER', 'PRO'])
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.wallet.overview(user);
  }

  @Get('banks')
  async banks() {
    return { banks: await this.wallet.gateway.listBanks().catch(() => []) };
  }

  @Put('bank-account')
  async setBank(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(bankAccountSchema)) body: BankAccountInput,
  ) {
    await enforceLimits(this.redis, [
      { key: `bank-account:${user.id}`, max: 10, windowSeconds: 24 * 60 * 60 },
    ]);
    return this.wallet.setBankAccount(user, body.bankCode, body.accountNumber);
  }

  @Post('withdrawals')
  @HttpCode(200)
  async withdraw(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(withdrawalSchema)) body: WithdrawalInput,
  ) {
    await enforceLimits(this.redis, [
      { key: `withdraw:${user.id}`, max: 10, windowSeconds: 24 * 60 * 60 },
    ]);
    return this.wallet.withdraw(user, body.amountKobo);
  }
}

const statusQuery = z
  .object({ status: z.enum(['PROCESSING', 'PAID', 'FAILED']).optional() })
  .strict();
const pauseSchema = z.object({ paused: z.boolean() }).strict();

/** Staff: see withdrawals, and pause all of them at once. */
@Controller('admin/withdrawals')
@UseGuards(JwtAuthGuard)
@Roles(['ADMIN', 'SUPER_ADMIN'])
export class AdminWithdrawalsController {
  constructor(
    private readonly wallet: WalletService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get()
  async list(@Query(new ZodValidationPipe(statusQuery)) query: z.infer<typeof statusQuery>) {
    return {
      paused: await this.wallet.paused(),
      withdrawals: await this.wallet.recentForStaff(query.status ? [query.status] : undefined),
    };
  }

  @Post('pause')
  @HttpCode(200)
  async pause(
    @CurrentUser() staff: AuthUser,
    @Body(new ZodValidationPipe(pauseSchema)) body: z.infer<typeof pauseSchema>,
  ) {
    if (body.paused) await this.redis.set(PAUSE_KEY, '1');
    else await this.redis.del(PAUSE_KEY);
    await this.db.insert(auditLogs).values({
      actorId: staff.id,
      action: body.paused ? 'WITHDRAWALS_PAUSED' : 'WITHDRAWALS_RESUMED',
      target: 'withdrawals',
    });
    return { paused: body.paused };
  }
}
