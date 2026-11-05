import type { AccountStatus, JobStatus, Role, VerificationStatus } from '@/lib/types';

export const ROLE_LABEL: Record<Role, string> = {
  CUSTOMER: 'Customer',
  PRO: 'Pro',
  ADMIN: 'Staff',
  SUPER_ADMIN: 'Super-admin',
};

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  BANNED: 'Banned',
};

export const CHECK_LABEL: Record<VerificationStatus, string> = {
  NOT_STARTED: 'Not verified',
  PENDING: 'Check waiting',
  APPROVED: 'Verified',
  REJECTED: 'Check rejected',
  NEEDS_INFO: 'Check sent back',
};

/** Short job statuses for staff lists. */
export const JOB_STATUS_SHORT: Record<JobStatus, string> = {
  REQUESTED: 'Looking for a Pro',
  ACCEPTED: 'Pro accepted',
  INSPECTION_PAID: 'Inspection paid',
  QUOTED: 'Quoted',
  QUOTE_ACCEPTED: 'Quote accepted',
  IN_PROGRESS: 'In progress',
  DONE_AWAITING_PAYMENT: 'Done, awaiting payment',
  BALANCE_HELD: 'Balance held',
  COMPLETED: 'Completed',
  CASH_COMPLETED: 'Completed (cash)',
  DISPUTED: 'Disputed',
  CANCELLED: 'Cancelled',
};

export const dateTime = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
