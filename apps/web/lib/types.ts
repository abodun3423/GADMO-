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
  };
  you: 'CUSTOMER' | 'PRO';
  other: { id: string; name: string | null } | null;
  open: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  body: string;
  wasMasked: boolean;
  createdAt: string;
  mine: boolean;
}
