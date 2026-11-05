import { randomInt, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { formatNaira } from '@gadmo/shared';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { AlertsService } from '../alerts/alerts.service';
import { ENV, type Env } from '../config/env';
import { categories, jobs, ledgerEntries, messages, payments } from '../db/schema';
import type { FieldCrypto } from '../common/field-crypto';
import { DB, type Db, FIELD_CRYPTO } from '../infra/infra.module';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway';

/** A checkout page is reused if the customer taps Pay again within this time. */
const CHECKOUT_REUSE_MINUTES = 30;

export const REFERENCE_PATTERN = /^gadmo_[0-9a-f]{32}$/;

export interface PaymentView {
  reference: string;
  jobId: string;
  type: 'INSPECTION_FEE' | 'DEPOSIT' | 'BALANCE';
  amountKobo: number;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
}

const paymentView = {
  reference: payments.paystackReference,
  jobId: payments.jobId,
  type: payments.type,
  amountKobo: payments.amountKobo,
  status: payments.status,
};

/**
 * In-app payments (PRD section 6). The customer pays on the provider's checkout page; GADMO
 * believes a payment only after asking the provider itself (never the browser), and records
 * each one exactly once, with balanced ledger entries.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYMENT_GATEWAY) readonly gateway: PaymentGateway,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
    private readonly alerts: AlertsService,
  ) {}

  /** The customer starts paying the agreed inspection fee. Returns the checkout page. */
  async startInspectionFee(customerId: string, jobId: string) {
    const prepared = await this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({
          status: jobs.status,
          inspectionFeeKobo: jobs.inspectionFeeKobo,
          policy: categories.inspectionPolicy,
        })
        .from(jobs)
        .innerJoin(categories, eq(categories.id, jobs.categoryId))
        .where(and(eq(jobs.id, jobId), eq(jobs.customerId, customerId)))
        .for('update', { of: jobs });
      if (!job) throw new NotFoundException();
      if (job.policy === 'NONE') {
        throw new ConflictException('This service has no inspection fee.');
      }
      if (job.status === 'INSPECTION_PAID') {
        throw new ConflictException('The inspection fee is already paid.');
      }
      if (job.inspectionFeeKobo === null) {
        throw new ConflictException('Agree the inspection fee with your Pro in the chat first.');
      }
      if (job.status !== 'ACCEPTED') {
        throw new ConflictException('The inspection fee can’t be paid at this stage.');
      }
      const amountKobo = job.inspectionFeeKobo;

      const [recent] = await tx
        .select({ reference: payments.paystackReference, checkoutUrl: payments.checkoutUrl })
        .from(payments)
        .where(
          and(
            eq(payments.jobId, jobId),
            eq(payments.type, 'INSPECTION_FEE'),
            eq(payments.status, 'PENDING'),
            eq(payments.amountKobo, amountKobo),
            eq(payments.gateway, this.gateway.name),
            gt(payments.createdAt, sql`now() - make_interval(mins => ${CHECKOUT_REUSE_MINUTES})`),
          ),
        )
        .orderBy(desc(payments.createdAt))
        .limit(1);
      if (recent?.checkoutUrl) {
        return { reference: recent.reference!, authorizationUrl: recent.checkoutUrl, reuse: true };
      }

      const reference = `gadmo_${randomUUID().replace(/-/g, '')}`;
      await tx.insert(payments).values({
        jobId,
        type: 'INSPECTION_FEE',
        method: 'APP',
        paystackReference: reference,
        amountKobo,
        gateway: this.gateway.name,
      });
      return { reference, amountKobo, reuse: false };
    });
    if (prepared.reuse) {
      return { reference: prepared.reference, authorizationUrl: prepared.authorizationUrl! };
    }

    const { reference } = prepared;
    try {
      const { authorizationUrl } = await this.gateway.initialize({
        reference,
        amountKobo: prepared.amountKobo!,
        // Paystack needs an email. GADMO never shares the customer's contact details,
        // so it sends a private alias instead.
        email: `customer-${customerId}@pay.gadmo.ng`,
        callbackUrl: new URL('/pay/return', this.env.WEB_ORIGIN).toString(),
        metadata: { jobId, type: 'INSPECTION_FEE' },
      });
      await this.db
        .update(payments)
        .set({ checkoutUrl: authorizationUrl })
        .where(eq(payments.paystackReference, reference));
      return { reference, authorizationUrl };
    } catch (err) {
      this.log.error(`Could not start payment ${reference}: ${(err as Error).message}`);
      await this.db
        .update(payments)
        .set({ status: 'FAILED' })
        .where(eq(payments.paystackReference, reference));
      throw new ServiceUnavailableException('Payments aren’t available right now. Try again soon.');
    }
  }

  /** A payment the caller may see: only the job's customer. Otherwise 404. */
  async findForCustomer(reference: string, customerId: string): Promise<PaymentView> {
    const [row] = await this.db
      .select(paymentView)
      .from(payments)
      .innerJoin(jobs, eq(jobs.id, payments.jobId))
      .where(and(eq(payments.paystackReference, reference), eq(jobs.customerId, customerId)))
      .limit(1);
    if (!row) throw new NotFoundException();
    return row as PaymentView;
  }

  /**
   * Asks the provider what happened and records the outcome. Safe to call any number of
   * times (return page, webhook, retries): a payment is recorded once.
   */
  async confirm(reference: string): Promise<PaymentView | null> {
    const check = await this.gateway.verify(reference);
    let paidJob: { id: string; proId: string | null; amount: number } | null = null;
    const result = await this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select({
          id: payments.id,
          ...paymentView,
          gateway: payments.gateway,
        })
        .from(payments)
        .where(eq(payments.paystackReference, reference))
        .for('update');
      if (!payment) return null;
      const view = (): PaymentView => ({
        reference: payment.reference!,
        jobId: payment.jobId,
        type: payment.type,
        amountKobo: payment.amountKobo,
        status: payment.status,
      });
      if (payment.status !== 'PENDING' || check.status === 'pending') return view();
      if (payment.gateway !== this.gateway.name) return view();

      if (check.status === 'failed') {
        await tx.update(payments).set({ status: 'FAILED' }).where(eq(payments.id, payment.id));
        payment.status = 'FAILED';
        return view();
      }
      if (check.amountKobo !== payment.amountKobo || check.currency !== 'NGN') {
        // Never credit a different amount than agreed; staff resolve it by hand.
        this.log.error(
          `Payment ${reference} came back as ${check.amountKobo} ${check.currency}, expected ${payment.amountKobo} NGN`,
        );
        await tx.update(payments).set({ status: 'FAILED' }).where(eq(payments.id, payment.id));
        payment.status = 'FAILED';
        return view();
      }

      await tx
        .update(payments)
        .set({ status: 'SUCCEEDED', paidAt: sql`now()` })
        .where(eq(payments.id, payment.id));
      payment.status = 'SUCCEEDED';

      const [job] = await tx
        .select({
          id: jobs.id,
          status: jobs.status,
          customerId: jobs.customerId,
          proId: jobs.proId,
        })
        .from(jobs)
        .where(eq(jobs.id, payment.jobId))
        .for('update');
      const counts = payment.type === 'INSPECTION_FEE' && job!.status === 'ACCEPTED';
      const txnId = randomUUID();
      const amount = payment.amountKobo;
      await tx.insert(ledgerEntries).values([
        {
          txnId,
          account: `gateway:${this.gateway.name}:clearing`,
          debitKobo: amount,
          jobId: job!.id,
          description: `Payment ${reference} received`,
        },
        {
          txnId,
          // Held by GADMO until the Pro arrives; a payment that no longer applies
          // (paid twice, or the job moved on) is owed back to the customer.
          account: counts ? `escrow:job:${job!.id}` : `refund-due:customer:${job!.customerId}`,
          creditKobo: amount,
          jobId: job!.id,
          description: counts ? 'Inspection fee held until the Pro arrives' : 'To refund',
        },
      ]);
      if (counts) {
        // The customer gives this code to the Pro on arrival; it releases the fee.
        const arrivalCode = String(randomInt(0, 10_000)).padStart(4, '0');
        await tx
          .update(jobs)
          .set({
            status: 'INSPECTION_PAID',
            arrivalCodeEncrypted: this.crypto.encrypt(arrivalCode),
          })
          .where(eq(jobs.id, job!.id));
        await tx.insert(messages).values({
          jobId: job!.id,
          senderId: job!.customerId,
          kind: 'EVENT',
          body: `Inspection fee paid: ${naira(amount)}. GADMO holds it until the Pro arrives and enters the customer’s arrival code.`,
        });
        paidJob = { id: job!.id, proId: job!.proId, amount };
      } else {
        this.log.warn(`Payment ${reference} no longer applies to job ${job!.id}; refund due`);
        await tx.insert(messages).values({
          jobId: job!.id,
          senderId: job!.customerId,
          kind: 'EVENT',
          body: `A second payment of ${naira(amount)} was received. GADMO will refund it.`,
        });
      }
      return view();
    });
    const paid = paidJob as { id: string; proId: string | null; amount: number } | null;
    if (paid?.proId) {
      this.alerts.send(paid.proId, {
        title: 'Inspection fee paid',
        body: `The customer paid the inspection fee (${naira(paid.amount)}). Tap “I’m on my way” in the job chat when you set off.`,
        url: `/jobs/${paid.id}`,
        tag: `job-${paid.id}`,
      });
    }
    return result;
  }
}

function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
