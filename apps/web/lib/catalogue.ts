import type { Category, InspectionPolicy } from './types';

export const INSPECTION_NOTE: Record<InspectionPolicy, string> = {
  REQUIRED: 'Inspection visit first (fee agreed in chat, max ₦5,000)',
  OPTIONAL: 'Inspection only if the Pro needs to see the job',
  NONE: 'No inspection fee. The Pro quotes directly',
};

export function serviceNote(c: Category): string {
  return c.emergencyEnabled
    ? `${INSPECTION_NOTE[c.inspectionPolicy]}. Available for emergencies`
    : INSPECTION_NOTE[c.inspectionPolicy];
}
