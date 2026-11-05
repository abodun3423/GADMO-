import { createHmac, timingSafeEqual } from 'node:crypto';

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface CheckoutRequest {
  reference: string;
  amountKobo: number;
  /** Paystack requires an email; GADMO sends a private alias, never a real address. */
  email: string;
  /** Where the customer comes back to after paying. */
  callbackUrl: string;
  metadata: Record<string, string>;
}

export interface PaymentCheck {
  status: 'success' | 'failed' | 'pending';
  amountKobo: number;
  currency: string;
}

export interface PaymentGateway {
  readonly name: 'test' | 'paystack';
  /** Starts a checkout and returns the page to send the customer to. */
  initialize(request: CheckoutRequest): Promise<{ authorizationUrl: string }>;
  /** Asks the provider what happened to a payment. Never trust the browser for this. */
  verify(reference: string): Promise<PaymentCheck>;
}

/**
 * Real Paystack (https://paystack.com/docs/api/transaction). Card data never touches
 * GADMO: the customer pays on Paystack's own checkout page.
 */
export class PaystackGateway implements PaymentGateway {
  readonly name = 'paystack' as const;
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async initialize(request: CheckoutRequest): Promise<{ authorizationUrl: string }> {
    const res = await this.call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        reference: request.reference,
        amount: request.amountKobo,
        currency: 'NGN',
        email: request.email,
        callback_url: request.callbackUrl,
        metadata: request.metadata,
      }),
    });
    const url = (res.data as { authorization_url?: unknown } | undefined)?.authorization_url;
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error('Paystack did not return a checkout page');
    }
    return { authorizationUrl: url };
  }

  async verify(reference: string): Promise<PaymentCheck> {
    const res = await this.call(`/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
    });
    const data = res.data as { status?: string; amount?: number; currency?: string } | undefined;
    return {
      status:
        data?.status === 'success'
          ? 'success'
          : data?.status === 'failed' || data?.status === 'abandoned' || data?.status === 'reversed'
            ? 'failed'
            : 'pending',
      amountKobo: Number(data?.amount ?? 0),
      currency: String(data?.currency ?? ''),
    };
  }

  /** A webhook is genuine only if signed with our secret key (HMAC-SHA512 of the raw body). */
  isGenuineWebhook(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = Buffer.from(
      createHmac('sha512', this.secretKey).update(rawBody).digest('hex'),
    );
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private async call(path: string, init: RequestInit): Promise<{ data?: unknown }> {
    const res = await this.fetchImpl(`https://api.paystack.co${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: boolean; data?: unknown };
    if (!res.ok || body.status !== true) throw new Error(`Paystack ${path} failed (${res.status})`);
    return body;
  }
}

/**
 * GADMO's own test checkout, for development and automated tests: no money moves.
 * The "checkout page" is /pay/test in the web app; the outcome is recorded here.
 * env.ts refuses this gateway in production.
 */
export class TestGateway implements PaymentGateway {
  readonly name = 'test' as const;
  private readonly outcomes = new Map<string, PaymentCheck>();
  constructor(private readonly webOrigin: string) {}

  async initialize(request: CheckoutRequest): Promise<{ authorizationUrl: string }> {
    const url = new URL('/pay/test', this.webOrigin);
    url.searchParams.set('reference', request.reference);
    return { authorizationUrl: url.toString() };
  }

  /** The test checkout page reports what the tester chose. */
  complete(reference: string, amountKobo: number, status: 'success' | 'failed'): void {
    this.outcomes.set(reference, { status, amountKobo, currency: 'NGN' });
  }

  async verify(reference: string): Promise<PaymentCheck> {
    return this.outcomes.get(reference) ?? { status: 'pending', amountKobo: 0, currency: 'NGN' };
  }
}
