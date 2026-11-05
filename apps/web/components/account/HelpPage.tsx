'use client';

import Link from 'next/link';
import { useSession } from '@/lib/useSession';
import { AccountShell } from './AccountShell';

const COMMON = [
  {
    q: 'Why can’t I see the other person’s phone number?',
    a: 'GADMO keeps everyone’s number private. You chat, send photos and voice notes, and call inside GADMO. It keeps you safe and keeps your payment protected.',
  },
  {
    q: 'Is my money safe?',
    a: 'Payments made in GADMO are held by GADMO, not by the Pro, until each step is done: the inspection fee until the Pro arrives, and the balance for 12 hours after the job (longer if you report a problem). Cash payments are between you and the Pro and are not covered.',
  },
];

const CUSTOMER = [
  {
    q: 'What is the inspection fee?',
    a: 'For repairs, the Pro may need to see the job first. You agree a fee in the chat (never more than ₦5,000) and pay it in GADMO. It counts toward the final bill.',
  },
  {
    q: 'What is my arrival code?',
    a: 'After you pay the inspection fee you see a 4-digit code in the job chat. Give it to your Pro only when they are with you. It proves they arrived and releases the fee to them.',
  },
  {
    q: 'What if the Pro doesn’t come?',
    a: 'Don’t give them the code. The fee stays held by GADMO, never with the Pro, until they arrive.',
  },
  {
    q: 'How do I find a Pro?',
    a: 'Choose a service on the home page. For an emergency we alert the nearest available Pro; for later, you choose from verified Pros near you.',
  },
];

const PRO = [
  {
    q: 'How do I get requests?',
    a: 'Add your skills and area, verify your identity, then go online on Jobs & requests. Emergencies near you pop up with 2 minutes to accept; customers booking for later can choose you from a list.',
  },
  {
    q: 'How do I get paid the inspection fee?',
    a: 'When you arrive, tap “I have arrived” in the job chat and enter the 4-digit code the customer gives you. The fee moves to your GADMO balance straight away.',
  },
  {
    q: 'When can I withdraw?',
    a: 'Your available balance can be sent to your bank account (₦1,000 or more). GADMO pays the transfer fee.',
  },
  {
    q: 'Why was I asked to verify my identity?',
    a: 'Customers only see verified Pros. GADMO staff check your NIN, ID photo and selfie by hand, usually within a day.',
  },
];

export function HelpPage() {
  const { me } = useSession();
  const pro = me?.role === 'PRO';
  const faqs = [...(pro ? PRO : CUSTOMER), ...COMMON];
  return (
    <AccountShell>
      <h1 className="page-title">Help</h1>
      <p className="lede">Answers to common questions about using GADMO.</p>
      <section className="panel faq">
        {faqs.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>
      <section className="panel">
        <h2 className="panel-title">Stay safe</h2>
        <ul className="ticks">
          <li>Never pay or chat outside GADMO: we can only protect what happens here.</li>
          <li>GADMO staff will never ask for your login code or card PIN.</li>
          <li>
            {pro
              ? 'Only enter an arrival code the customer gives you in person.'
              : 'Only give your arrival code to the Pro when they are with you.'}
          </li>
        </ul>
      </section>
      <section className="panel">
        <h2 className="panel-title">Something wrong with a job?</h2>
        <p className="meta">
          Tell the other person in the job chat first. A “Report a problem” button on each job is
          coming soon; until then, don’t release any code or payment you’re unsure about.
        </p>
        <Link className="button button-quiet button-small" href={pro ? '/pro' : '/jobs'}>
          Go to my jobs
        </Link>
      </section>
    </AccountShell>
  );
}
