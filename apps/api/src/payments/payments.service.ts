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
import { categories, jobs, ledgerEntries, messages, payments, quotes } from '../db/schema';
import type { FieldCrypto } from '../common/field-crypto';
import { DB, type Db, FIELD_CRYPTO } from '../infra/infra.module';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway';

/** A checkout page is reused if the customer taps Pay again within this time. */
const CHECKOUT_REUSE_MINUTES = 30;

export const REFERENCE_PATTERN = /^gadmo_[0-9a-f]{32}$/;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

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
    return this.checkout(customerId, jobId, 'INSPECTION_FEE', async (tx) => {
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
      return { amountKobo: job.inspectionFeeKobo, quoteId: null };
    });
  }

  /** The customer accepts a quote by paying its materials deposit. */
  async startDeposit(customerId: string, quoteId: string) {
    const [found] = await this.db
      .select({ jobId: quotes.jobId })
      .from(quotes)
      .innerJoin(jobs, eq(jobs.id, quotes.jobId))
      .where(and(eq(quotes.id, quoteId), eq(jobs.customerId, customerId)));
    if (!found) throw new NotFoundException();
    return this.checkout(customerId, found.jobId, 'DEPOSIT', async (tx) => {
      const [job] = await tx
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, found.jobId))
        .for('update');
      const [quote] = await tx
        .select({ status: quotes.status, depositKobo: quotes.depositKobo })
        .from(quotes)
        .where(eq(quotes.id, quoteId));
      if (quote!.status !== 'PENDING' || job!.status !== 'QUOTED') {
        throw new ConflictException('This quote can no longer be accepted.');
      }
      if (quote!.depositKobo <= 0) {
        throw new ConflictException('This quote has no deposit to pay.');
      }
      return { amountKobo: quote!.depositKobo, quoteId };
    });
  }

  /**
   * Creates (or reuses, within CHECKOUT_REUSE_MINUTES) a pending payment and its checkout
   * page. `prepare` checks the job inside the transaction and says how much to charge.
   */
  private async checkout(
    customerId: string,
    jobId: string,
    type: 'INSPECTION_FEE' | 'DEPOSIT',
    prepare: (tx: Tx) => Promise<{ amountKobo: number; quoteId: string | null }>,
  ) {
    const prepared = await this.db.transaction(async (tx) => {
      const { amountKobo, quoteId } = await prepare(tx);
      const [recent] = await tx
        .select({ reference: payments.paystackReference, checkoutUrl: payments.checkoutUrl })
        .from(payments)
        .where(
          and(
            eq(payments.jobId, jobId),
            eq(payments.type, type),
            eq(payments.status, 'PENDING'),
            eq(payments.amountKobo, amountKobo),
            eq(payments.gateway, this.gateway.name),
            quoteId ? eq(payments.quoteId, quoteId) : undefined,
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
        type,
        method: 'APP',
        paystackReference: reference,
        amountKobo,
        quoteId,
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
        metadata: { jobId, type },
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
    let paidJob: {
      id: string;
      proId: string | null;
      amount: number;
      type: 'INSPECTION_FEE' | 'DEPOSIT';
    } | null = null;
    const result = await this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select({
          id: payments.id,
          ...paymentView,
          gateway: payments.gateway,
          quoteId: payments.quoteId,
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
      // Does the payment still do what it was for? If not (paid twice, the quote was
      // withdrawn, the job moved on) it is owed back to the customer.
      let quote:
        { id: string; status: string; depositKobo: number; amountKobo: number } | undefined;
      if (payment.type === 'DEPOSIT' && payment.quoteId) {
        [quote] = await tx
          .select({
            id: quotes.id,
            status: quotes.status,
            depositKobo: quotes.depositKobo,
            amountKobo: quotes.amountKobo,
          })
          .from(quotes)
          .where(eq(quotes.id, payment.quoteId))
          .for('update');
      }
      const counts =
        payment.type === 'INSPECTION_FEE'
          ? job!.status === 'ACCEPTED'
          : payment.type === 'DEPOSIT' &&
            job!.status === 'QUOTED' &&
            quote?.status === 'PENDING' &&
            quote.depositKobo === payment.amountKobo;
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
          account: counts ? `escrow:job:${job!.id}` : `refund-due:customer:${job!.customerId}`,
          creditKobo: amount,
          jobId: job!.id,
          description: !counts
            ? 'Refund: a payment that was no longer needed'
            : payment.type === 'DEPOSIT'
              ? 'Materials deposit held until work starts'
              : 'Inspection fee held until the Pro arrives',
        },
      ]);
      if (counts && payment.type === 'INSPECTION_FEE') {
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
        paidJob = { id: job!.id, proId: job!.proId, amount, type: 'INSPECTION_FEE' };
      } else if (counts && quote) {
        await tx
          .update(quotes)
          .set({ status: 'ACCEPTED', acceptedAt: sql`now()`, respondedAt: sql`now()` })
          .where(eq(quotes.id, quote.id));
        await tx.update(jobs).set({ status: 'QUOTE_ACCEPTED' }).where(eq(jobs.id, job!.id));
        await tx.insert(messages).values({
          jobId: job!.id,
          senderId: job!.customerId,
          kind: 'EVENT',
          body: `Quote of ${naira(quote.amountKobo)} accepted. Materials deposit of ${naira(amount)} paid: GADMO holds it until work starts.`,
        });
        paidJob = { id: job!.id, proId: job!.proId, amount, type: 'DEPOSIT' };
      } else {
        this.log.warn(`Payment ${reference} no longer applies to job ${job!.id}; refund due`);
        await tx.insert(messages).values({
          jobId: job!.id,
          senderId: job!.customerId,
          kind: 'EVENT',
          body: `A payment of ${naira(amount)} was no longer needed. It has been added to your GADMO wallet as a refund.`,
        });
      }
      return view();
    });
    const paid = paidJob as {
      id: string;
      proId: string | null;
      amount: number;
      type: 'INSPECTION_FEE' | 'DEPOSIT';
    } | null;
    if (paid?.proId) {
      this.alerts.send(
        paid.proId,
        paid.type === 'DEPOSIT'
          ? {
              title: 'Quote accepted',
              body: `The customer accepted your quote and paid the ${naira(paid.amount)} materials deposit. It’s released to you when you start work.`,
              url: `/jobs/${paid.id}`,
              tag: `job-${paid.id}`,
            }
          : {
              title: 'Inspection fee paid',
              body: `The customer paid the inspection fee (${naira(paid.amount)}). Tap “I’m on my way” in the job chat when you set off.`,
              url: `/jobs/${paid.id}`,
              tag: `job-${paid.id}`,
            },
        { sms: paid.type === 'DEPOSIT' },
      );
    }
    return result;
  }
}

function naira(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, '');
}
