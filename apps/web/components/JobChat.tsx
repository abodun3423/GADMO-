'use client';

import { AlertsPrompt } from './AlertsPrompt';

import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, fieldMessage, post } from '@/lib/api';
import type { ChatMessage, Conversation, MessagesResponse, OfferStatus } from '@/lib/types';
import { InspectionPanel, OfferCard } from './InspectionFee';
import { useSession } from '@/lib/useSession';

/** New messages are checked for every few seconds while the chat is on screen. */
const POLL_MS = 4000;

const timeFormat = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' });

export function JobChat({ jobId }: { jobId: string }) {
  const { me, loading } = useSession();
  const [convo, setConvo] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [offerStatus, setOfferStatus] = useState<Record<string, OfferStatus>>({});
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastAt = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const addMessages = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const known = new Set(current.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      return fresh.length ? [...current, ...fresh] : current;
    });
    lastAt.current = incoming[incoming.length - 1]!.createdAt;
  }, []);

  const poll = useCallback(async () => {
    try {
      const query = lastAt.current ? `?after=${encodeURIComponent(lastAt.current)}` : '';
      const res = await api<MessagesResponse>(`/v1/jobs/${jobId}/messages${query}`);
      addMessages(res.messages);
      setOfferStatus(Object.fromEntries(res.offers.map((o) => [o.id, o.status])));
      setConvo((c) =>
        c &&
        (c.job.inspectionFeeKobo !== res.inspectionFeeKobo ||
          c.job.status !== res.jobStatus ||
          c.job.onTheWayAt !== res.visit.onTheWayAt ||
          c.job.arrivedAt !== res.visit.arrivedAt)
          ? {
              ...c,
              job: {
                ...c.job,
                inspectionFeeKobo: res.inspectionFeeKobo,
                status: res.jobStatus,
                ...res.visit,
                // The code is used up once the Pro has arrived.
                arrivalCode: res.visit.arrivedAt ? null : c.job.arrivalCode,
              },
            }
          : c,
      );
    } catch {
      // Try again on the next tick.
    }
  }, [jobId, addMessages]);

  useEffect(() => {
    if (!me) return;
    api<{ conversation: Conversation }>(`/v1/jobs/${jobId}/conversation`)
      .then((r) => setConvo(r.conversation))
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? 'This job does not exist, or it isn’t yours.'
            : 'This job could not be loaded. Check your connection and refresh.',
        ),
      );
  }, [me, jobId]);

  const chatting = !!convo?.other;
  useEffect(() => {
    if (!chatting) return;
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [chatting, poll]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setError(null);
    setSending(true);
    try {
      const res = await post<{ message: ChatMessage; notice: string | null }>(
        `/v1/jobs/${jobId}/messages`,
        { body },
      );
      addMessages([res.message]);
      setNotice(res.notice);
      setDraft('');
    } catch (err) {
      setError(
        fieldMessage(err) ??
          (err instanceof ApiError
            ? err.message
            : 'Not sent. Check your connection and try again.'),
      );
    } finally {
      setSending(false);
    }
  }

  if (loading) return <p className="meta">Loading…</p>;
  if (!me) {
    return (
      <>
        <h1 className="page-title">Job chat</h1>
        <p className="lede">Sign in to see this job.</p>
        <Link className="button" href={`/signin?next=${encodeURIComponent(`/jobs/${jobId}`)}`}>
          Sign in
        </Link>
      </>
    );
  }

  const back = me.role === 'PRO' ? '/pro' : '/jobs';
  const otherLabel = convo?.you === 'CUSTOMER' ? 'Your Pro' : 'Customer';

  return (
    <>
      <p className="meta">
        <Link href={back}>← {me.role === 'PRO' ? 'Pro home' : 'My jobs'}</Link>
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!convo && !error && <p className="meta">Loading…</p>}

      {convo && (
        <>
          <header className="chat-head">
            <h1 className="page-title">{convo.job.serviceName}</h1>
            <p className="meta">
              {convo.other
                ? `${otherLabel}: ${convo.other.name ?? 'name not added yet'}`
                : 'Waiting for a Pro to accept'}
            </p>
            <p className="chat-job">{convo.job.description}</p>
          </header>

          {!convo.other ? (
            <p className="empty">Chat opens as soon as a Pro accepts this job.</p>
          ) : (
            <>
              {convo.open && (
                <AlertsPrompt why="so you see new messages even when this chat isn’t open." />
              )}
              {convo.open && (
                <InspectionPanel
                  convo={convo}
                  pending={Object.values(offerStatus).includes('PENDING')}
                  onChanged={poll}
                />
              )}

              <p className="chat-rule">
                Keep all messages and payments in GADMO. Phone numbers, emails and links are hidden
                automatically, and GADMO can only protect payments made in the app.
              </p>

              <ol className="chat" aria-label="Messages" aria-live="polite">
                {messages.length === 0 && (
                  <li className="chat-empty">
                    {convo.you === 'PRO'
                      ? 'Say hello and agree the details of the job.'
                      : 'Say hello and tell your Pro anything they should know.'}
                  </li>
                )}
                {messages.map((m) =>
                  m.kind === 'OFFER' && m.offer ? (
                    <OfferCard
                      key={m.id}
                      message={m}
                      status={offerStatus[m.offer.id] ?? m.offer.status}
                      canAnswer={!m.mine && convo.open && convo.job.inspectionFeeKobo === null}
                      onChanged={poll}
                    />
                  ) : m.kind === 'EVENT' ? (
                    <li key={m.id} className="chat-event">
                      {m.body}
                    </li>
                  ) : (
                    <li key={m.id} className={`bubble ${m.mine ? 'bubble-mine' : 'bubble-theirs'}`}>
                      <span className="sr-only">{m.mine ? 'You' : otherLabel}: </span>
                      <span className="bubble-text">{m.body}</span>
                      <span className="bubble-meta">
                        {timeFormat.format(new Date(m.createdAt))}
                        {m.wasMasked && ' · contact details hidden'}
                      </span>
                    </li>
                  ),
                )}
              </ol>
              <div ref={endRef} />

              {notice && (
                <p className="alert alert-info" role="status">
                  {notice}
                </p>
              )}

              {convo.open ? (
                <form className="composer" onSubmit={send} noValidate>
                  <label htmlFor="message" className="sr-only">
                    Message
                  </label>
                  <textarea
                    id="message"
                    rows={2}
                    maxLength={1000}
                    placeholder="Write a message"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button className="button" type="submit" disabled={sending || !draft.trim()}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </form>
              ) : (
                <p className="empty">This chat is closed.</p>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
