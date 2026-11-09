import type { Conversation } from '@/lib/types';

type Step = { key: string; label: string };

/**
 * Where the job stands, as a short row of steps under the chat header: accepted, the
 * inspection visit (only for jobs that have one), the quote, the work and payment.
 */
export function JobProgress({ job }: { job: Conversation['job'] }) {
  const visitFirst =
    job.inspectionPolicy === 'REQUIRED' ||
    (job.inspectionPolicy === 'OPTIONAL' && job.inspectionFeeKobo !== null);
  const steps: Step[] = [
    { key: 'accepted', label: 'Accepted' },
    ...(visitFirst ? [{ key: 'inspection', label: 'Inspection' }] : []),
    { key: 'quote', label: 'Quote' },
    { key: 'work', label: 'Work' },
    { key: 'paid', label: 'Paid' },
  ];
  const current = currentStep(job, visitFirst);
  if (current === null) return null;
  const at = current === 'done' ? steps.length : steps.findIndex((s) => s.key === current);

  return (
    <ol className="progress" aria-label="Job progress">
      {steps.map((s, i) => {
        const state = i < at ? 'done' : i === at ? 'now' : 'next';
        return (
          <li
            key={s.key}
            className={`progress-step progress-${state}`}
            aria-current={state === 'now' ? 'step' : undefined}
          >
            <span className="progress-dot" aria-hidden="true">
              {state === 'done' ? (
                <svg viewBox="0 0 24 24">
                  <path d="m5 12 4.5 4.5L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className="progress-label">
              {s.label}
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function currentStep(job: Conversation['job'], visitFirst: boolean): string | 'done' | null {
  switch (job.status) {
    case 'ACCEPTED':
      return visitFirst ? 'inspection' : 'quote';
    case 'INSPECTION_PAID':
      return job.arrivedAt ? 'quote' : 'inspection';
    case 'QUOTED':
      return 'quote';
    case 'QUOTE_ACCEPTED':
    case 'IN_PROGRESS':
      return 'work';
    case 'DONE_AWAITING_PAYMENT':
    case 'BALANCE_HELD':
    case 'DISPUTED':
      return 'paid';
    case 'COMPLETED':
    case 'CASH_COMPLETED':
      return 'done';
    default:
      return null;
  }
}
