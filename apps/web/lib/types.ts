export type InspectionPolicy = 'REQUIRED' | 'OPTIONAL' | 'NONE';

export interface Category {
  id: string;
  name: string;
  slug: string;
  emergencyEnabled: boolean;
  inspectionPolicy: InspectionPolicy;
  licenceRequired: boolean;
}

export interface CategoryGroup {
  id: string;
  name: string;
  slug: string;
  categories: Category[];
}

export type Role = 'CUSTOMER' | 'PRO' | 'ADMIN' | 'SUPER_ADMIN';

export interface Me {
  id: string;
  phone: string;
  name: string | null;
  role: Role;
}

export type JobStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'INSPECTION_PAID'
  | 'QUOTED'
  | 'QUOTE_ACCEPTED'
  | 'IN_PROGRESS'
  | 'DONE_AWAITING_PAYMENT'
  | 'BALANCE_HELD'
  | 'COMPLETED'
  | 'CASH_COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED';

export interface Job {
  id: string;
  customerId: string;
  proId: string | null;
  categoryId: string;
  type: 'EMERGENCY' | 'SCHEDULED';
  status: JobStatus;
  description: string;
  scheduledAt: string | null;
  createdAt: string;
  /** Name of the assigned Pro, once one has accepted. */
  proName: string | null;
  /** Open emergencies: with a Pro right now, or waiting for one to come online. */
  dispatch: 'OFFERED' | 'NO_PRO_YET' | null;
}

/** An emergency offer to the signed-in Pro (GET /v1/pro/offers). */
export interface Offer {
  id: string;
  distanceKm: number;
  secondsLeft: number;
  job: {
    id: string;
    categoryId: string;
    type: 'EMERGENCY' | 'SCHEDULED';
    description: string;
    createdAt: string;
  };
}

/** Plain-language status for customers. */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  REQUESTED: 'Finding a Pro near you',
  ACCEPTED: 'A Pro accepted. Agree the inspection fee in chat',
  INSPECTION_PAID: 'Inspection fee paid. The Pro is on the way',
  QUOTED: 'Quote received. Review it',
  QUOTE_ACCEPTED: 'Quote accepted',
  IN_PROGRESS: 'Work in progress',
  DONE_AWAITING_PAYMENT: 'Work done. Pay the balance',
  BALANCE_HELD: 'Payment held for 12 hours',
  COMPLETED: 'Completed',
  CASH_COMPLETED: 'Completed (paid in cash)',
  DISPUTED: 'Under review by GADMO',
  CANCELLED: 'Cancelled',
};

export type VerificationStatus = 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'NEEDS_INFO';

/** The signed-in Pro's own profile (GET /v1/pro/profile). */
export interface ProProfile {
  categoryIds: string[];
  bio: string;
  latitude: number | null;
  longitude: number | null;
  serviceRadiusKm: number;
  isOnline: boolean;
  verificationStatus: VerificationStatus;
}

/** An open request near a Pro (GET /v1/pro/jobs/nearby). No customer identity or exact spot. */
export interface NearbyJob {
  id: string;
  categoryId: string;
  type: 'EMERGENCY' | 'SCHEDULED';
  description: string;
  scheduledAt: string | null;
  createdAt: string;
  distanceKm: number;
}

/** The signed-in Pro's identity check (GET /v1/pro/verification). The NIN is never returned. */
export interface VerificationState {
  status: VerificationStatus;
  canSubmit: boolean;
  submittedAt: string | null;
  note: string | null;
  photos: { idDocument: boolean; selfie: boolean };
}

export type ReviewResult = 'PENDING' | 'APPROVED' | 'REJECTED' | 'NEEDS_INFO';

/** A row in the staff review queue (GET /v1/admin/verifications). */
export interface ReviewItem {
  id: string;
  proId: string;
  proName: string | null;
  result: ReviewResult;
  createdAt: string;
  reviewedAt: string | null;
  ninUsedElsewhere: number;
}

/** One identity check for staff (GET /v1/admin/verifications/:id). */
export interface ReviewDetail extends ReviewItem {
  proPhone: string;
  proJoinedAt: string;
  nin: string | null;
  reviewNote: string | null;
  skills: string[];
  history: { id: string; result: ReviewResult; createdAt: string; reviewNote: string | null }[];
}

/** A job as one of its two parties sees it (GET /v1/jobs/:id/conversation). */
export interface Conversation {
  job: {
    id: string;
    status: JobStatus;
    type: 'EMERGENCY' | 'SCHEDULED';
    description: string;
    scheduledAt: string | null;
    createdAt: string;
    serviceName: string;
    inspectionPolicy: InspectionPolicy;
    /** Agreed in chat; null until both sides agree. */
    inspectionFeeKobo: number | null;
  };
  you: 'CUSTOMER' | 'PRO';
  other: { id: string; name: string | null } | null;
  open: boolean;
}

export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'COUNTERED' | 'DECLINED';

export interface ChatMessage {
  id: string;
  senderId: string;
  /** TEXT, OFFER (an inspection-fee offer card) or EVENT (e.g. "fee agreed"). */
  kind: 'TEXT' | 'OFFER' | 'EVENT';
  body: string;
  wasMasked: boolean;
  createdAt: string;
  mine: boolean;
  offer: { id: string; amountKobo: number; note: string | null; status: OfferStatus } | null;
}

export interface MessagesResponse {
  messages: ChatMessage[];
  offers: { id: string; status: OfferStatus }[];
  inspectionFeeKobo: number | null;
}

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';

/** Staff: GET /v1/admin/overview */
export interface AdminOverviewData {
  customers: number;
  pros: number;
  staff: number;
  prosVerified: number;
  prosOnline: number;
  checksWaiting: number;
  jobsToday: number;
  jobsByStatus: Partial<Record<JobStatus, number>>;
}

/** Staff: a row in GET /v1/admin/users */
export interface AdminUserRow {
  id: string;
  name: string | null;
  phone: string;
  role: Role;
  status: AccountStatus;
  chatFlags: number;
  createdAt: string;
  verificationStatus: VerificationStatus | null;
  isOnline: boolean | null;
}

/** Staff: a row in GET /v1/admin/jobs */
export interface AdminJobRow {
  id: string;
  type: 'EMERGENCY' | 'SCHEDULED';
  status: JobStatus;
  description: string;
  serviceName: string;
  customerId: string;
  customerName: string | null;
  proId: string | null;
  proName: string | null;
  inspectionFeeKobo: number | null;
  scheduledAt: string | null;
  createdAt: string;
}

/** Staff: GET /v1/admin/users/:id */
export interface AdminUserDetail extends Omit<AdminUserRow, 'verificationStatus' | 'isOnline'> {
  email: string | null;
  pro: {
    bio: string | null;
    serviceRadiusKm: number;
    isOnline: boolean;
    verificationStatus: VerificationStatus;
    ratingAvg: number;
    ratingCount: number;
  } | null;
  skills: string[];
  latestCheck: { id: string; result: ReviewResult } | null;
  recentJobs: AdminJobRow[];
  statusHistory: {
    action: string;
    metadata: { from?: string; to?: string; reason?: string } | null;
    createdAt: string;
  }[];
}
