import { randomInt, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BALANCE_HOLD_HOURS,
  EMERGENCY_VISIT_MINUTES,
  formatNaira,
  SCHEDULED_VISIT_GRACE_MINUTES,
} from '@gadmo/shared';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { AlertsService } from '../alerts/alerts.service';
import { ENV, type Env } from '../config/env';
import { categories, jobs, ledgerEntries, messages, payments, quotes } from '../db/schema';
import type { FieldCrypto } from '../common/field-crypto';
import { DB, type Db, FIELD_CRYPTO } from '../infra/infra.module';
import {
  accountBalance,
  BalanceService,
  jobBalanceKobo,
  quotePayNowKobo,
} from '../work/balance.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway';

/** A checkout page is reused if the customer taps Pay again within this time. */
const CHECKOUT_REUSE_MINUTES = 30;

export const REFERENCE_PATTERN = /^gadmo_[0-9a-f]{32}$/;

/** The `gateway` of a payment made wholly from the customer's GADMO wallet. */
export const WALLET_GATEWAY = 'wallet';

/** A customer's GADMO wallet (their refunds), as a ledger account. */
function customerWallet(customerId: string): string {
  return `refund-due:customer:${customerId}`;
}

/** The same lock withdrawals take, so wallet money can't be spent twice at once. */
async function lockWallet(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wallet:${userId}`}))`);
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface PaymentView {
  reference: string;
  jobId: string;
  type: 'INSPECTION_FEE' | 'DEPOSIT' | 'BALANCE';
  amountKobo: number;
  /** The part paid from the customer's GADMO wallet. */
  walletKobo: number;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
}

const paymentView = {
  reference: payments.paystackReference,
  jobId: payments.jobId,
  type: payments.type,
  amountKobo: payments.amountKobo,
  walletKobo: payments.walletKobo,
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
    private readonly balances: BalanceService,
  ) {}

  /** The customer starts paying the agreed inspection fee. Returns the checkout page. */
  async startInspectionFee(customerId: string, jobId: string, useWallet = true) {
    return this.checkout(customerId, jobId, 'INSPECTION_FEE', useWallet, async (tx) => {
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

  /**
   * The customer accepts a quote by paying it in full, up front (founder decision): the
   * materials deposit goes straight to the Pro; the rest is held by GADMO until the job is
   * done, then released when the customer is satisfied or 12 hours after "Job done".
   */
  async startQuotePayment(customerId: string, quoteId: string, useWallet = true) {
    const [found] = await this.db
      .select({ jobId: quotes.jobId })
      .from(quotes)
      .innerJoin(jobs, eq(jobs.id, quotes.jobId))
      .where(and(eq(quotes.id, quoteId), eq(jobs.customerId, customerId)));
    if (!found) throw new NotFoundException();
    return this.checkout(customerId, found.jobId, 'DEPOSIT', useWallet, async (tx) => {
      const [job] = await tx
        .select({
          status: jobs.status,
          inspectionFeeKobo: jobs.inspectionFeeKobo,
          arrivedAt: jobs.arrivedAt,
        })
        .from(jobs)
        .where(eq(jobs.id, found.jobId))
        .for('update');
      const [quote] = await tx
        .select({ status: quotes.status, amountKobo: quotes.amountKobo })
        .from(quotes)
        .where(eq(quotes.id, quoteId));
      if (quote!.status !== 'PENDING' || job!.status !== 'QUOTED') {
        throw new ConflictException('This quote can no longer be accepted.');
      }
      const amountKobo = quotePayNowKobo(quote!.amountKobo, job!);
      if (amountKobo <= 0) throw new ConflictException('There is nothing to pay on this quote.');
      return { amountKobo, quoteId };
    });
  }

  /** After the Pro marks the job done, the customer pays the balance in the app. */
  async startBalance(customerId: string, jobId: string, useWallet = true) {
    return this.checkout(customerId, jobId, 'BALANCE', useWallet, async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          status: jobs.status,
          inspectionFeeKobo: jobs.inspectionFeeKobo,
          arrivedAt: jobs.arrivedAt,
        })
        .from(jobs)
        .where(and(eq(jobs.id, jobId), eq(jobs.customerId, customerId)))
        .for('update');
      if (!job) throw new NotFoundException();
      if (job.status !== 'DONE_AWAITING_PAYMENT') {
        throw new ConflictException(
          job.status === 'BALANCE_HELD' || job.status === 'COMPLETED'
            ? 'The balance is already paid.'
            : 'The balance is due once your Pro marks the job done.',
        );
      }
      const amountKobo = await jobBalanceKobo(tx, job);
      if (!amountKobo) throw new ConflictException('There is no balance to pay.');
      return { amountKobo, quoteId: null };
    });
  }

  /**
   * Creates (or reuses, within CHECKOUT_REUSE_MINUTES) a pending payment and its checkout
   * page. `prepare` checks the job inside the transaction and says how much to charge.
   *
   * With `useWallet`, money in the customer's GADMO wallet pays first (founder decision,
   * November 2026): if it covers everything, the payment is made at once with no checkout
   * page (the customer goes straight to the payment result); otherwise the card pays the
   * rest. The wallet is only debited when the payment is confirmed.
   */
  private async checkout(
    customerId: string,
    jobId: string,
    type: 'INSPECTION_FEE' | 'DEPOSIT' | 'BALANCE',
    useWallet: boolean,
    prepare: (tx: Tx) => Promise<{ amountKobo: number; quoteId: string | null }>,
  ) {
    const prepared = await this.db.transaction(async (tx) => {
      const { amountKobo, quoteId } = await prepare(tx);
      let walletKobo = 0;
      if (useWallet) {
        await lockWallet(tx, customerId);
        walletKobo = Math.min(amountKobo, await accountBalance(tx, customerWallet(customerId)));
      }
      if (walletKobo === amountKobo) {
        const reference = `gadmo_${randomUUID().replace(/-/g, '')}`;
        await tx.insert(payments).values({
          jobId,
          type,
          method: 'APP',
          paystackReference: reference,
          amountKobo,
          walletKobo,
          quoteId,
          gateway: WALLET_GATEWAY,
        });
        return { reference, walletOnly: true as const };
      }
      const [recent] = await tx
        .select({ reference: payments.paystackReference, checkoutUrl: payments.checkoutUrl })
        .from(payments)
        .where(
          and(
            eq(payments.jobId, jobId),
            eq(payments.type, type),
            eq(payments.status, 'PENDING'),
            eq(payments.amountKobo, amountKobo),
            eq(payments.walletKobo, walletKobo),
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
        walletKobo,
        quoteId,
        gateway: this.gateway.name,
      });
      return { reference, cardKobo: amountKobo - walletKobo, reuse: false };
    });
    if ('walletOnly' in prepared) {
      // Paid from the wallet alone: settle it now and show the customer the result page.
      await this.settle(prepared.reference, { status: 'success', amountKobo: 0, currency: 'NGN' });
      const result = new URL('/pay/return', this.env.WEB_ORIGIN);
      result.searchParams.set('reference', prepared.reference);
      return { reference: prepared.reference, authorizationUrl: result.toString() };
    }
    if (prepared.reuse) {
      return { reference: prepared.reference, authorizationUrl: prepared.authorizationUrl! };
    }

    const { reference } = prepared;
    try {
      const { authorizationUrl } = await this.gateway.initialize({
        reference,
        amountKobo: prepared.cardKobo!,
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
    const [found] = await this.db
      .select({ gateway: payments.gateway })
      .from(payments)
      .where(eq(payments.paystackReference, reference));
    if (!found) return null;
    if (found.gateway === WALLET_GATEWAY) return this.view(reference); // settled when made
    return this.settle(reference, await this.gateway.verify(reference));
  }

  private async view(reference: string): Promise<PaymentView | null> {
    const [row] = await this.db
      .select(paymentView)
      .from(payments)
      .where(eq(payments.paystackReference, reference));
    return (row as PaymentView | undefined) ?? null;
  }

  /** Records what the provider (or, for wallet-only payments, GADMO) says happened. */
  private async settle(
    reference: string,
    check: { status: 'success' | 'failed' | 'pending'; amountKobo: number; currency: string },
  ): Promise<PaymentView | null> {
    let paidJob: {
      id: string;
      proId: string | null;
      amount: number;
      type: 'INSPECTION_FEE' | 'DEPOSIT' | 'BALANCE';
      held?: number;
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
        walletKobo: payment.walletKobo,
        status: payment.status,
      });
      if (payment.status !== 'PENDING' || check.status === 'pending') return view();
      if (payment.gateway !== this.gateway.name && payment.gateway !== WALLET_GATEWAY) {
        return view();
      }
      const card = payment.amountKobo - payment.walletKobo;

      if (check.status === 'failed') {
        await tx.update(payments).set({ status: 'FAILED' }).where(eq(payments.id, payment.id));
        payment.status = 'FAILED';
        return view();
      }
      if (check.amountKobo !== card || check.currency !== 'NGN') {
        // Never credit a different amount than agreed; staff resolve it by hand.
        this.log.error(
          `Payment ${reference} came back as ${check.amountKobo} ${check.currency}, expected ${card} NGN`,
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
          inspectionFeeKobo: jobs.inspectionFeeKobo,
          arrivedAt: jobs.arrivedAt,
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
      // The wallet part is taken now; if the wallet no longer holds it (spent or withdrawn
      // meanwhile), the payment doesn't count and any card money goes to the wallet.
      let walletOk = true;
      if (payment.walletKobo > 0) {
        await lockWallet(tx, job!.customerId);
        walletOk =
          (await accountBalance(tx, customerWallet(job!.customerId))) >= payment.walletKobo;
      }
      const counts =
        walletOk &&
        (payment.type === 'INSPECTION_FEE'
          ? job!.status === 'ACCEPTED'
          : payment.type === 'BALANCE'
            ? job!.status === 'DONE_AWAITING_PAYMENT' &&
              (await jobBalanceKobo(tx, job!)) === payment.amountKobo
            : payment.type === 'DEPOSIT' &&
              job!.status === 'QUOTED' &&
              quote?.status === 'PENDING' &&
              quotePayNowKobo(quote.amountKobo, job!) === payment.amountKobo);
      if (!counts && card === 0) {
        // Nothing came in from a card, so nothing is owed back.
        await tx.update(payments).set({ status: 'FAILED' }).where(eq(payments.id, payment.id));
        payment.status = 'FAILED';
        return view();
      }
      const txnId = randomUUID();
      const amount = counts ? payment.amountKobo : card;
      const received: (typeof ledgerEntries.$inferInsert)[] = [];
      if (card > 0) {
        received.push({
          txnId,
          account: `gateway:${payment.gateway}:clearing`,
          debitKobo: card,
          jobId: job!.id,
          description: `Payment ${reference} received`,
        });
      }
      if (counts && payment.walletKobo > 0) {
        received.push({
          txnId,
          account: customerWallet(job!.customerId),
          debitKobo: payment.walletKobo,
          jobId: job!.id,
          description: 'Paid from your GADMO wallet',
        });
      }
      // A quote is paid in full up front (founder decision): the materials deposit goes
      // straight to the Pro so they can buy what the job needs; the rest is held by GADMO
      // until the job is done. The inspection fee is held until the Pro arrives.
      const deposit =
        counts && payment.type === 'DEPOSIT' ? Math.min(quote!.depositKobo, amount) : 0;
      const credits: (typeof ledgerEntries.$inferInsert)[] = !counts
        ? [
            {
              txnId,
              account: `refund-due:customer:${job!.customerId}`,
              creditKobo: amount,
              jobId: job!.id,
              description: 'Refund: a payment that was no longer needed',
            },
          ]
        : payment.type === 'DEPOSIT'
          ? [
              ...(deposit > 0
                ? [
                    {
                      txnId,
                      account: `pro:${job!.proId}`,
                      creditKobo: deposit,
                      jobId: job!.id,
                      description: 'Materials deposit, paid to the Pro',
                    },
                  ]
                : []),
              ...(amount - deposit > 0
                ? [
                    {
                      txnId,
                      account: `escrow:job:${job!.id}`,
                      creditKobo: amount - deposit,
                      jobId: job!.id,
                      description: 'Balance held by GADMO until the job is done',
                    },
                  ]
                : []),
            ]
          : [
              {
                txnId,
                account: `escrow:job:${job!.id}`,
                creditKobo: amount,
                jobId: job!.id,
                description:
                  payment.type === 'BALANCE'
                    ? `Balance held for ${BALANCE_HOLD_HOURS} hours`
                    : 'Inspection fee held until the Pro arrives',
              },
            ];
      await tx.insert(ledgerEntries).values([...received, ...credits]);
      if (counts && payment.type === 'INSPECTION_FEE') {
        // The customer gives this code to the Pro on arrival; it releases the fee.
        const arrivalCode = String(randomInt(0, 10_000)).padStart(4, '0');
        await tx
          .update(jobs)
          .set({
            status: 'INSPECTION_PAID',
            arrivalCodeEncrypted: this.crypto.encrypt(arrivalCode),
            visitDueAt: visitDueSql(),
          })
          .where(eq(jobs.id, job!.id));
        await tx.insert(messages).values({
          jobId: job!.id,
          senderId: job!.customerId,
          kind: 'EVENT',
          body: `Inspection fee paid: ${naira(amount)}. GADMO holds it until the Pro arrives and enters the customer’s arrival code.`,
        });
        paidJob = { id: job!.id, proId: job!.proId, amount, type: 'INSPECTION_FEE' };
      } else if (counts && payment.type === 'BALANCE') {
        // Every balance is paid in the app (there is no cash option); GADMO holds it.
        await tx.update(jobs).set({ paymentMethod: 'APP' }).where(eq(jobs.id, job!.id));
        await this.balances.hold(tx, job!.id);
        await tx.insert(messages).values({
          jobId: job!.id,
          senderId: job!.customerId,
          kind: 'EVENT',
          body: `Balance paid: ${naira(amount)}. GADMO holds it for ${BALANCE_HOLD_HOURS} hours, then pays the Pro. If something is wrong with the work, report it before then; if all is good, you can confirm sooner.`,
        });
        paidJob = { id: job!.id, proId: job!.proId, amount, type: 'BALANCE' };
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
          body:
            deposit > 0
              ? `Quote of ${naira(quote.amountKobo)} accepted and paid: ${naira(deposit)} materials deposit to the Pro now; GADMO holds ${naira(amount - deposit)} until the job is done.`
              : `Quote of ${naira(quote.amountKobo)} accepted and paid: GADMO holds ${naira(amount)} until the job is done.`,
        });
        paidJob = {
          id: job!.id,
          proId: job!.proId,
          amount: deposit,
          held: amount - deposit,
          type: 'DEPOSIT',
        };
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
      held?: number;
      type: 'INSPECTION_FEE' | 'DEPOSIT' | 'BALANCE';
    } | null;
    if (paid?.proId) {
      this.alerts.send(
        paid.proId,
        paid.type === 'BALANCE'
          ? {
              title: 'Balance paid',
              body: `The customer paid the ${naira(paid.amount)} balance. GADMO pays it into your wallet within ${BALANCE_HOLD_HOURS} hours, unless they report a problem.`,
              url: `/jobs/${paid.id}`,
              tag: `job-${paid.id}`,
            }
          : paid.type === 'DEPOSIT'
            ? {
                title: 'Quote accepted',
                body:
                  paid.amount > 0
                    ? `The customer accepted your quote and paid it in full. The ${naira(paid.amount)} deposit is in your wallet now; GADMO holds ${naira(paid.held ?? 0)} and pays it after the job is done.`
                    : `The customer accepted your quote and paid it in full. GADMO holds ${naira(paid.held ?? 0)} and pays it after the job is done.`,
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

/**
 * When the customer may cancel with a refund if the Pro hasn't come (founder decision): 2h30
 * after paying for an emergency; for a scheduled job, 1 hour after the booked time (or 2h30
 * after paying, if that is later).
 */
export function visitDueSql() {
  return sql`case when ${jobs.type} = 'SCHEDULED' and ${jobs.scheduledAt} is not null
    then greatest(${jobs.scheduledAt} + make_interval(mins => ${SCHEDULED_VISIT_GRACE_MINUTES}),
                  now() + make_interval(mins => ${EMERGENCY_VISIT_MINUTES}))
    else now() + make_interval(mins => ${EMERGENCY_VISIT_MINUTES}) end`;
}
