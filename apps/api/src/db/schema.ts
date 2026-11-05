/**
 * GADMO database schema — PRD v1.0, section 7.
 * Money columns are whole kobo (₦1 = 100 kobo), stored as bigint.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const kobo = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const roleEnum = pgEnum('role', ['CUSTOMER', 'PRO', 'ADMIN', 'SUPER_ADMIN']);
export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'BANNED']);
export const verificationStatusEnum = pgEnum('verification_status', [
  'NOT_STARTED',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'NEEDS_INFO',
]);
export const jobTypeEnum = pgEnum('job_type', ['EMERGENCY', 'SCHEDULED']);
export const jobStatusEnum = pgEnum('job_status', [
  'REQUESTED',
  'ACCEPTED',
  'INSPECTION_PAID',
  'QUOTED',
  'QUOTE_ACCEPTED',
  'IN_PROGRESS',
  'DONE_AWAITING_PAYMENT',
  'BALANCE_HELD',
  'COMPLETED',
  'CASH_COMPLETED',
  'DISPUTED',
  'CANCELLED',
]);
export const paymentTypeEnum = pgEnum('payment_type', ['INSPECTION_FEE', 'DEPOSIT', 'BALANCE']);
export const paymentMethodEnum = pgEnum('payment_method', ['APP', 'CASH']);
export const paymentStatusEnum = pgEnum('payment_status', [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'REFUNDED',
]);
export const payoutStatusEnum = pgEnum('payout_status', [
  'PENDING',
  'PROCESSING',
  'PAID',
  'FAILED',
]);
export const disputeStatusEnum = pgEnum('dispute_status', [
  'OPEN',
  'RESOLVED_PRO_PAID',
  'RESOLVED_REFUNDED',
  'RESOLVED_SPLIT',
  'RESOLVED_REWORK',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** E.164. Never returned to other users. */
  phone: text('phone').notNull().unique(),
  name: text('name'),
  /** Staff only: they sign in with email + password + a code to their phone. Lower case. */
  email: text('email').unique(),
  /** Staff only: scrypt hash (see auth/password.ts). */
  passwordHash: text('password_hash'),
  role: roleEnum('role').notNull().default('CUSTOMER'),
  status: userStatusEnum('status').notNull().default('ACTIVE'),
  /** Count of attempts to share contact details in chat. */
  chatFlags: integer('chat_flags').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** All rotations of one login. Reusing an old token revokes the whole family. */
    familyId: uuid('family_id').notNull(),
    /** SHA-256 of the token. The raw token is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    userAgent: text('user_agent'),
    /** 'staff' sessions end at a fixed time (no sliding renewal); 'app' sessions slide. */
    kind: text('kind').notNull().default('app'),
    createdAt: createdAt(),
  },
  (t) => [
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

/**
 * REQUIRED: the Pro must visit and agree an inspection fee before quoting (repairs, construction).
 * OPTIONAL: the Pro may ask for one if they need to see the work first (cleaning, moving).
 * NONE: no inspection fee — tech, lessons, beauty, events and businesses quote directly.
 */
export const inspectionPolicyEnum = pgEnum('inspection_policy', ['REQUIRED', 'OPTIONAL', 'NONE']);

/** Top-level rows (parentId null) are groups shown on the home screen; their children are bookable. */
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
  emergencyEnabled: boolean('emergency_enabled').notNull().default(false),
  inspectionPolicy: inspectionPolicyEnum('inspection_policy').notNull().default('NONE'),
  /** Regulated work (lawyers, nurses, vets…): a professional licence is checked during verification. */
  licenceRequired: boolean('licence_required').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const proProfiles = pgTable('pro_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  bio: text('bio'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  serviceRadiusKm: integer('service_radius_km').notNull().default(10),
  isOnline: boolean('is_online').notNull().default(false),
  ratingAvg: doublePrecision('rating_avg').notNull().default(0),
  ratingCount: integer('rating_count').notNull().default(0),
  verificationStatus: verificationStatusEnum('verification_status')
    .notNull()
    .default('NOT_STARTED'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const proCategories = pgTable(
  'pro_categories',
  {
    proId: uuid('pro_id')
      .notNull()
      .references(() => proProfiles.userId, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.proId, t.categoryId] })],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proId: uuid('pro_id')
      .notNull()
      .references(() => proProfiles.userId, { onDelete: 'cascade' }),
    /** 'manual' (GADMO staff review) until a KYC provider is connected. */
    provider: text('provider').notNull(),
    /** AES-256-GCM ciphertext. */
    ninEncrypted: text('nin_encrypted'),
    /** Keyed hash of the NIN, to spot one NIN used on several accounts without decrypting. */
    ninHash: text('nin_hash'),
    /** Object-storage key, never a public URL ("file:<id>" while files live in private_files). */
    selfieRef: text('selfie_ref'),
    /** Photo of an ID document (NIN slip, ID card, voter's card, licence or passport). */
    idDocumentRef: text('id_document_ref'),
    result: verificationStatusEnum('result').notNull().default('PENDING'),
    reviewedById: uuid('reviewed_by_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Shown to the Pro when more information is needed or the check is not approved. */
    reviewNote: text('review_note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('verifications_pro_idx').on(t.proId),
    index('verifications_result_idx').on(t.result),
    index('verifications_nin_hash_idx').on(t.ninHash),
  ],
);

export const privateFilePurposeEnum = pgEnum('private_file_purpose', ['ID_DOCUMENT', 'SELFIE']);

/**
 * Sensitive uploads (identity photos), encrypted with FIELD_ENCRYPTION_KEY and never
 * served publicly. A file with no verificationId is a draft the Pro is still preparing.
 * To be moved to private object storage later; references keep the "file:<id>" form.
 */
export const privateFiles = pgTable(
  'private_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: privateFilePurposeEnum('purpose').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    dataEncrypted: text('data_encrypted').notNull(),
    verificationId: uuid('verification_id').references(() => verifications.id, {
      onDelete: 'cascade',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('private_files_owner_idx').on(t.ownerId, t.purpose)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    proId: uuid('pro_id').references(() => users.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    type: jobTypeEnum('type').notNull(),
    status: jobStatusEnum('status').notNull().default('REQUESTED'),
    description: text('description').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    /** Revealed to the Pro only after the inspection fee is paid. */
    addressEncrypted: text('address_encrypted'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    paymentMethod: paymentMethodEnum('payment_method'),
    cashAgreementVersion: text('cash_agreement_version'),
    cashAgreementAcceptedAt: timestamp('cash_agreement_accepted_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    /** Agreed in chat (Pro offers, customer accepts or counters); never above ₦5,000. */
    inspectionFeeKobo: kobo('inspection_fee_kobo'),
    inspectionAgreedAt: timestamp('inspection_agreed_at', { withTimezone: true }),
    /** doneAt + 12 hours for in-app balances. */
    balanceReleaseAt: timestamp('balance_release_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_customer_idx').on(t.customerId),
    index('jobs_pro_idx').on(t.proId),
    index('jobs_status_idx').on(t.status),
    check(
      'jobs_inspection_fee_range',
      sql`${t.inspectionFeeKobo} is null or (${t.inspectionFeeKobo} > 0 and ${t.inspectionFeeKobo} <= 500000)`,
    ),
  ],
);

export const inspectionOfferStatusEnum = pgEnum('inspection_offer_status', [
  'PENDING',
  'ACCEPTED',
  'COUNTERED',
  'DECLINED',
]);

/**
 * Inspection-fee offers made in chat (PRD section 5): the Pro proposes, then each side
 * accepts, counters or declines. One PENDING offer per job at a time.
 */
export const inspectionOffers = pgTable(
  'inspection_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    proposedById: uuid('proposed_by_id')
      .notNull()
      .references(() => users.id),
    amountKobo: kobo('amount_kobo').notNull(),
    /** Why this amount (distance, urgency…). Masked for contact details. */
    note: text('note'),
    status: inspectionOfferStatusEnum('status').notNull().default('PENDING'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('inspection_offers_job_idx').on(t.jobId, t.createdAt),
    uniqueIndex('inspection_offers_one_pending_per_job')
      .on(t.jobId)
      .where(sql`${t.status} = 'PENDING'`),
    check('inspection_offers_amount_range', sql`${t.amountKobo} > 0 and ${t.amountKobo} <= 500000`),
  ],
);

export const offerStatusEnum = pgEnum('offer_status', [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'WITHDRAWN',
]);

/**
 * Emergency dispatch: a request is offered to one Pro at a time, nearest first, for
 * EMERGENCY_OFFER_SECONDS. Each Pro is offered a job at most once, and the database
 * allows only one PENDING offer per job.
 */
export const jobOffers = pgTable(
  'job_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    proId: uuid('pro_id')
      .notNull()
      .references(() => users.id),
    status: offerStatusEnum('status').notNull().default('PENDING'),
    /** Distance from the Pro's base to the job when offered, in km. */
    distanceKm: doublePrecision('distance_km').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // A Pro who let an emergency offer run out can be offered the same job again later,
    // so (job, Pro) is not unique; the dispatcher enforces who may be asked again.
    index('job_offers_job_pro_idx').on(t.jobId, t.proId),
    uniqueIndex('job_offers_one_pending_per_job')
      .on(t.jobId)
      .where(sql`${t.status} = 'PENDING'`),
    index('job_offers_pro_status_idx').on(t.proId, t.status),
  ],
);

export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    amountKobo: kobo('amount_kobo').notNull(),
    depositKobo: kobo('deposit_kobo').notNull().default(0),
    description: text('description').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('quotes_amount_positive', sql`${t.amountKobo} > 0`),
    check(
      'quotes_deposit_cap',
      sql`${t.depositKobo} >= 0 AND ${t.depositKobo} * 2 <= ${t.amountKobo}`,
    ),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    type: paymentTypeEnum('type').notNull(),
    method: paymentMethodEnum('method').notNull().default('APP'),
    /** Unique so a replayed Paystack webhook is processed only once. */
    paystackReference: text('paystack_reference').unique(),
    amountKobo: kobo('amount_kobo').notNull(),
    status: paymentStatusEnum('status').notNull().default('PENDING'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    /** 'paystack' or 'test' (GADMO's test checkout; never in production). */
    gateway: text('gateway'),
    /** The checkout page, reused if the customer taps Pay again before it expires. */
    checkoutUrl: text('checkout_url'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payments_job_idx').on(t.jobId),
    check('payments_amount_nonneg', sql`${t.amountKobo} >= 0`),
  ],
);

/** Double-entry ledger. Append-only: a trigger blocks UPDATE and DELETE. */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Entries with the same txnId must balance (sum of debits = sum of credits). */
    txnId: uuid('txn_id').notNull(),
    /** e.g. "escrow:job:<id>", "pro:<id>", "gadmo:commission". */
    account: text('account').notNull(),
    debitKobo: kobo('debit_kobo').notNull().default(0),
    creditKobo: kobo('credit_kobo').notNull().default(0),
    jobId: uuid('job_id').references(() => jobs.id),
    description: text('description').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_account_idx').on(t.account),
    index('ledger_txn_idx').on(t.txnId),
    check(
      'ledger_one_side',
      sql`${t.debitKobo} >= 0 AND ${t.creditKobo} >= 0 AND (${t.debitKobo} = 0) <> (${t.creditKobo} = 0)`,
    ),
  ],
);

export const payouts = pgTable('payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  proId: uuid('pro_id')
    .notNull()
    .references(() => proProfiles.userId),
  /** Paystack transfer-recipient code, never a raw account number. */
  bankAccountRef: text('bank_account_ref').notNull(),
  amountKobo: kobo('amount_kobo').notNull(),
  status: payoutStatusEnum('status').notNull().default('PENDING'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    /** Stored AFTER contact masking — the raw text is never saved. */
    body: text('body').notNull(),
    wasMasked: boolean('was_masked').notNull().default(false),
    /** TEXT, or OFFER for an inspection-fee offer card (see offerId). */
    kind: text('kind').notNull().default('TEXT'),
    offerId: uuid('offer_id').references(() => inspectionOffers.id),
    attachmentRef: text('attachment_ref'),
    createdAt: createdAt(),
  },
  (t) => [index('messages_job_idx').on(t.jobId, t.createdAt)],
);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => users.id),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('reviews_one_per_author').on(t.jobId, t.authorId),
    check('reviews_rating_range', sql`${t.rating} BETWEEN 1 AND 5`),
  ],
);

export const disputes = pgTable('disputes', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id),
  openedById: uuid('opened_by_id')
    .notNull()
    .references(() => users.id),
  reason: text('reason').notNull(),
  status: disputeStatusEnum('status').notNull().default('OPEN'),
  resolution: text('resolution'),
  resolvedById: uuid('resolved_by_id').references(() => users.id),
  createdAt: createdAt(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

/** Every admin action. Append-only: a trigger blocks UPDATE and DELETE. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    target: text('target').notNull(),
    metadata: jsonb('metadata'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_target_idx').on(t.target)],
);
