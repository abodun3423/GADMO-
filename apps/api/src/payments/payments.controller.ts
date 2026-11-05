import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles, SkipCsrf } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { REDIS } from '../infra/infra.module';
import { PaystackGateway, TestGateway } from './gateway';
import { PaymentsService, REFERENCE_PATTERN } from './payments.service';
import { WalletService, WITHDRAWAL_REFERENCE } from '../wallet/wallet.service';

const idPipe = new ZodValidationPipe(z.uuid());
const referencePipe = new ZodValidationPipe(z.string().regex(REFERENCE_PATTERN));
const testOutcomeSchema = z.object({ outcome: z.enum(['success', 'failed']) }).strict();

@Controller()
@UseGuards(JwtAuthGuard)
@Roles(['CUSTOMER'])
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Start paying the agreed inspection fee; the web app sends the customer to the page. */
  @Post('jobs/:jobId/inspection-fee/pay')
  @HttpCode(200)
  async payInspectionFee(@CurrentUser() user: AuthUser, @Param('jobId', idPipe) jobId: string) {
    await enforceLimits(this.redis, [
      { key: `pay-start:${user.id}`, max: 20, windowSeconds: 60 * 60 },
    ]);
    return this.payments.startInspectionFee(user.id, jobId);
  }

  /** Called when the customer comes back from the checkout page. */
  @Post('payments/:reference/check')
  @HttpCode(200)
  async check(@CurrentUser() user: AuthUser, @Param('reference', referencePipe) ref: string) {
    await this.payments.findForCustomer(ref, user.id);
    await enforceLimits(this.redis, [
      { key: `pay-check:${user.id}`, max: 120, windowSeconds: 60 * 60 },
    ]);
    return { payment: await this.payments.confirm(ref) };
  }

  /** GADMO's test checkout page (development and automated tests only). */
  @Get('payments/test/:reference')
  async testCheckout(
    @CurrentUser() user: AuthUser,
    @Param('reference', referencePipe) ref: string,
  ) {
    this.testGateway();
    return { payment: await this.payments.findForCustomer(ref, user.id) };
  }

  @Post('payments/test/:reference/complete')
  @HttpCode(200)
  async completeTest(
    @CurrentUser() user: AuthUser,
    @Param('reference', referencePipe) ref: string,
    @Body(new ZodValidationPipe(testOutcomeSchema)) body: z.infer<typeof testOutcomeSchema>,
  ) {
    const gateway = this.testGateway();
    const payment = await this.payments.findForCustomer(ref, user.id);
    if (payment.status !== 'PENDING') return { payment };
    gateway.complete(ref, payment.amountKobo, body.outcome);
    return { payment: await this.payments.confirm(ref) };
  }

  private testGateway(): TestGateway {
    const gateway = this.payments.gateway;
    if (!(gateway instanceof TestGateway)) throw new NotFoundException();
    return gateway;
  }
}

/**
 * Paystack tells GADMO about payments here (server to server, so no session or CSRF header).
 * Only signed events are accepted, and GADMO still re-checks each payment with Paystack.
 */
@Controller('payments/paystack')
export class PaystackWebhookController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly wallet: WalletService,
  ) {}

  @Post('webhook')
  @SkipCsrf(true)
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ) {
    const gateway = this.payments.gateway;
    if (!(gateway instanceof PaystackGateway)) throw new NotFoundException();
    if (!req.rawBody || !gateway.isGenuineWebhook(req.rawBody, signature)) {
      throw new UnauthorizedException();
    }
    const event = webhookSchema.safeParse(req.body);
    if (event.success && event.data.event === 'charge.success') {
      const reference = event.data.data.reference;
      if (REFERENCE_PATTERN.test(reference)) await this.payments.confirm(reference);
    }
    // transfer.success / transfer.failed / transfer.reversed: a wallet withdrawal.
    if (event.success && event.data.event.startsWith('transfer.')) {
      const reference = event.data.data.reference;
      if (WITHDRAWAL_REFERENCE.test(reference)) await this.wallet.recheck(reference);
    }
    return { received: true };
  }
}

const webhookSchema = z.object({
  event: z.string(),
  data: z.object({ reference: z.string().max(100) }),
});
