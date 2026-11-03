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
