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

export interface Bank {
  code: string;
  name: string;
}

export interface TransferRequest {
  reference: string;
  amountKobo: number;
  recipientCode: string;
  reason: string;
}

export type TransferStatus = 'success' | 'failed' | 'pending';

export interface PaymentGateway {
  readonly name: 'test' | 'paystack';
  /** Starts a checkout and returns the page to send the customer to. */
  initialize(request: CheckoutRequest): Promise<{ authorizationUrl: string }>;
  /** Asks the provider what happened to a payment. Never trust the browser for this. */
  verify(reference: string): Promise<PaymentCheck>;
  /** Nigerian banks that can receive transfers. */
  listBanks(): Promise<Bank[]>;
  /** The name on a bank account (null if the account doesn't exist). */
  resolveAccount(accountNumber: string, bankCode: string): Promise<string | null>;
  /** Registers a bank account to send money to; returns its recipient code. */
  createRecipient(name: string, accountNumber: string, bankCode: string): Promise<string>;
  /** Sends money to a registered bank account. */
  transfer(request: TransferRequest): Promise<TransferStatus>;
  /** Asks the provider what happened to a transfer. */
  verifyTransfer(reference: string): Promise<TransferStatus>;
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

  private banks: { at: number; list: Bank[] } | null = null;

  async listBanks(): Promise<Bank[]> {
    // The list rarely changes: keep it for a day.
    if (this.banks && Date.now() - this.banks.at < 24 * 60 * 60 * 1000) return this.banks.list;
    const res = await this.call('/bank?country=nigeria&currency=NGN&perPage=200', {
      method: 'GET',
    });
    const list = ((res.data as { code?: string; name?: string; active?: boolean }[]) ?? [])
      .filter((b) => b.active !== false && b.code && b.name)
      .map((b) => ({ code: String(b.code), name: String(b.name) }));
    this.banks = { at: Date.now(), list };
    return list;
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<string | null> {
    try {
      const res = await this.call(
        `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
        { method: 'GET' },
      );
      const name = (res.data as { account_name?: unknown } | undefined)?.account_name;
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    } catch {
      return null;
    }
  }

  async createRecipient(name: string, accountNumber: string, bankCode: string): Promise<string> {
    const res = await this.call('/transferrecipient', {
      method: 'POST',
      body: JSON.stringify({
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      }),
    });
    const code = (res.data as { recipient_code?: unknown } | undefined)?.recipient_code;
    if (typeof code !== 'string') throw new Error('Paystack did not return a recipient');
    return code;
  }

  async transfer(request: TransferRequest): Promise<TransferStatus> {
    try {
      const res = await this.call('/transfer', {
        method: 'POST',
        body: JSON.stringify({
          source: 'balance',
          amount: request.amountKobo,
          recipient: request.recipientCode,
          reference: request.reference,
          reason: request.reason,
          currency: 'NGN',
        }),
      });
      return transferStatus((res.data as { status?: string } | undefined)?.status);
    } catch {
      // Paystack may still have accepted it: the webhook or a later check settles it.
      return 'pending';
    }
  }

  async verifyTransfer(reference: string): Promise<TransferStatus> {
    const res = await this.call(`/transfer/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
    });
    return transferStatus((res.data as { status?: string } | undefined)?.status);
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
/** Paystack transfer statuses, in GADMO's three. */
function transferStatus(status: string | undefined): TransferStatus {
  if (status === 'success') return 'success';
  if (status === 'failed' || status === 'reversed' || status === 'abandoned') return 'failed';
  return 'pending';
}

/** A few real bank codes, so the test checkout looks like the real thing. */
const TEST_BANKS: Bank[] = [
  { code: '044', name: 'Access Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '058', name: 'Guaranty Trust Bank' },
  { code: '50211', name: 'Kuda Bank' },
  { code: '999992', name: 'OPay' },
  { code: '999991', name: 'PalmPay' },
  { code: '232', name: 'Sterling Bank' },
  { code: '033', name: 'United Bank For Africa' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
];

/**
 * GADMO's own test checkout, for development and automated tests: no money moves.
 * The "checkout page" is /pay/test in the web app; the outcome is recorded here.
 * Test transfers succeed at once; an account number starting with 000 doesn't exist,
 * and one starting with 999 fails to receive money. env.ts refuses this gateway in
 * production.
 */
export class TestGateway implements PaymentGateway {
  readonly name = 'test' as const;
  private readonly outcomes = new Map<string, PaymentCheck>();
  private readonly transfers = new Map<string, TransferStatus>();
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

  async listBanks(): Promise<Bank[]> {
    return TEST_BANKS;
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<string | null> {
    if (accountNumber.startsWith('000') || !TEST_BANKS.some((b) => b.code === bankCode)) {
      return null;
    }
    return 'TEST ACCOUNT HOLDER';
  }

  async createRecipient(_name: string, accountNumber: string, bankCode: string): Promise<string> {
    return `RCP_test_${bankCode}_${accountNumber}`;
  }

  async transfer(request: TransferRequest): Promise<TransferStatus> {
    const status: TransferStatus = /_999\d{7}$/.test(request.recipientCode) ? 'failed' : 'success';
    this.transfers.set(request.reference, status);
    return status;
  }

  async verifyTransfer(reference: string): Promise<TransferStatus> {
    return this.transfers.get(reference) ?? 'pending';
  }
}
