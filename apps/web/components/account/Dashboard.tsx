'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/money';
import { type AccountSummary, type Job, JOB_STATUS_LABEL } from '@/lib/types';
import { useSession } from '@/lib/useSession';
import { Account } from '../Account';
import { AlertsPrompt } from '../AlertsPrompt';
import { AccountShell } from './AccountShell';
import { Icon } from './Icon';
import { SignedOut } from './SignedOut';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** The account home: where things stand, what to do next, and recent jobs. */
export function Dashboard({ serviceNames }: { serviceNames: Record<string, string> }) {
  const { me, loading } = useSession();
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!me || (me.role !== 'CUSTOMER' && me.role !== 'PRO')) return;
    Promise.all([
      api<{ summary: AccountSummary }>('/v1/me/summary'),
      api<{ jobs: Job[] }>('/v1/jobs'),
    ])
      .then(([s, j]) => {
        setSummary(s.summary);
        setJobs(j.jobs.slice(0, 4));
      })
      .catch(() => setError(true));
  }, [me]);

  if (loading) return <p className="meta">Loading…</p>;
  if (!me) return <SignedOut next="/account" title="Your account" />;
  // Staff have their own dashboard; their account page is just name and password.
  if (me.role !== 'CUSTOMER' && me.role !== 'PRO') return <Account />;

  const pro = me.role === 'PRO';
  const first = me.name?.split(' ')[0];
  return (
    <AccountShell>
      <header className="dash-head">
        <div>
          <h1 className="page-title">
            {greeting()}
            {first ? `, ${first}` : ''}
          </h1>
          <p className="meta">
            {pro
              ? 'Here’s how your GADMO work is going.'
              : 'Here’s what’s happening with your jobs.'}
          </p>
        </div>
        {pro && summary?.pro && (
          <span className={`status-pill ${summary.pro.isOnline ? 'status-on' : ''}`}>
            {summary.pro.isOnline ? 'Online' : 'Offline'}
          </span>
        )}
      </header>

      {!me.name && (
        <p className="alert alert-info">
          Add your name so {pro ? 'customers' : 'Pros'} know what to call you.{' '}
          <Link href="/account/profile">Add your name</Link>
        </p>
      )}
      {error && (
        <p className="alert alert-error" role="alert">
          Your dashboard could not be loaded. Check your connection and refresh.
        </p>
      )}
      {!summary && !error && <p className="meta">Loading…</p>}

      {summary && (
        <>
          <section className={`kpis${pro ? '' : ' kpis-4'}`} aria-label="At a glance">
            {pro ? (
              <>
                <Stat
                  label="Available balance"
                  value={money(summary.money.balanceKobo)}
                  note="Earnings you can withdraw"
                  strong
                />
                <Stat
                  label="On hold"
                  value={money(summary.money.heldKobo ?? 0)}
                  note="Paid by customers, released as jobs progress"
                />
                <Stat label="Total earned" value={money(summary.money.earnedKobo ?? 0)} />
                <Stat label="Jobs in progress" value={String(summary.jobs.active)} />
                <Stat label="Completed jobs" value={String(summary.jobs.completed)} />
                <Stat
                  label="Rating"
                  value={
                    summary.pro && summary.pro.ratingCount > 0
                      ? `★ ${summary.pro.ratingAvg.toFixed(1)}`
                      : 'New'
                  }
                  note={
                    summary.pro && summary.pro.ratingCount > 0
                      ? `${summary.pro.ratingCount} reviews`
                      : 'Reviews appear after your first jobs'
                  }
                />
              </>
            ) : (
              <>
                <Stat label="Open requests" value={String(summary.jobs.open)} />
                <Stat label="Jobs in progress" value={String(summary.jobs.active)} />
                <Stat label="Completed jobs" value={String(summary.jobs.completed)} />
                <Stat
                  label="Wallet"
                  value={money(summary.money.balanceKobo)}
                  note="Refunds from GADMO"
                  strong
                />
              </>
            )}
          </section>

          {pro && summary.pro && <ProChecklist pro={summary.pro} />}

          <section aria-labelledby="actions-title">
            <h2 id="actions-title" className="section-title">
              Quick actions
            </h2>
            <div className="actions">
              {pro ? (
                <>
                  <Action
                    href="/pro"
                    icon="jobs"
                    title="Jobs & requests"
                    text="Go online, see requests near you"
                  />
                  <Action
                    href="/pro/profile"
                    icon="tools"
                    title="Skills & area"
                    text="What you do and how far you travel"
                  />
                  <Action
                    href="/account/help"
                    icon="help"
                    title="How GADMO pays you"
                    text="Inspection fees, deposits and balances"
                  />
                </>
              ) : (
                <>
                  <Action
                    href="/"
                    icon="plus"
                    title="Request a service"
                    text="Plumbers, mechanics, tutors and more"
                  />
                  <Action
                    href="/jobs"
                    icon="jobs"
                    title="My jobs"
                    text="Chat, pay and follow your jobs"
                  />
                  <Action
                    href="/account/help"
                    icon="help"
                    title="How payments work"
                    text="Your money is held safely by GADMO"
                  />
                </>
              )}
            </div>
          </section>

          <AlertsPrompt
            why={
              pro
                ? 'so you hear about requests near you, even when GADMO isn’t open.'
                : 'so you know the moment a Pro accepts or messages you.'
            }
          />

          <section aria-labelledby="recent-title">
            <div className="section-row">
              <h2 id="recent-title" className="section-title">
                Recent jobs
              </h2>
              <Link href={pro ? '/pro' : '/jobs'}>See all</Link>
            </div>
            {jobs && jobs.length === 0 && (
              <p className="empty">
                {pro
                  ? 'No jobs yet. Go online and customers near you can send you requests.'
                  : 'No jobs yet. Find a skilled Pro near you from the home page.'}
              </p>
            )}
            <ul className="recent">
              {jobs?.map((j) => (
                <li key={j.id}>
                  <Link
                    href={j.proId ? `/jobs/${j.id}` : pro ? '/pro' : '/jobs'}
                    className="recent-job"
                  >
                    <span>
                      <strong>{serviceNames[j.categoryId] ?? 'Job'}</strong>
                      <span className="meta">{JOB_STATUS_LABEL[j.status]}</span>
                    </span>
                    <Icon name="arrow" size={18} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </AccountShell>
  );
}

function Stat({
  label,
  value,
  note,
  strong = false,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div className={`kpi${strong ? ' kpi-strong' : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {note && <span className="kpi-note">{note}</span>}
    </div>
  );
}

function Action({
  href,
  icon,
  title,
  text,
}: {
  href: string;
  icon: 'jobs' | 'tools' | 'help' | 'plus';
  title: string;
  text: string;
}) {
  return (
    <Link href={href} className="action">
      <span className="action-icon">
        <Icon name={icon} />
      </span>
      <span>
        <strong>{title}</strong>
        <span className="meta">{text}</span>
      </span>
    </Link>
  );
}

function ProChecklist({ pro }: { pro: NonNullable<AccountSummary['pro']> }) {
  const steps = [
    { done: pro.skills > 0, text: 'Add your skills and where you work', href: '/pro/profile' },
    {
      done: pro.verificationStatus === 'APPROVED',
      text:
        pro.verificationStatus === 'PENDING'
          ? 'Identity check: under review by GADMO'
          : 'Verify your identity (NIN and a selfie)',
      href: '/pro/verify',
    },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <section className="checklist" aria-labelledby="setup-title">
      <h2 id="setup-title" className="section-title">
        Finish setting up
      </h2>
      <ol>
        {steps.map((s) => (
          <li key={s.text} className={s.done ? 'step-done' : undefined}>
            {s.done ? s.text : <Link href={s.href}>{s.text}</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}
