'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, post } from '@/lib/api';

/** Call details as one side sees them (GET /v1/jobs/:id/calls/current). */
interface CallView {
  id: string;
  status: 'RINGING' | 'ACTIVE' | 'ENDED' | 'MISSED' | 'DECLINED';
  you: 'CALLER' | 'CALLEE';
  offerSdp: string | null;
  answerSdp: string | null;
  answeredAt: string | null;
}

/** The light summary the chat's message poll carries. */
export interface LiveCall {
  id: string;
  status: 'RINGING' | 'ACTIVE';
  you: 'CALLER' | 'CALLEE';
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'calling'; callId: string }
  | { kind: 'incoming'; callId: string; offer: string }
  | { kind: 'connecting'; callId: string }
  | { kind: 'active'; callId: string; since: number };

const POLL_MS = 1000;

/** Waits until the browser has found its network routes (or 3 seconds). */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', done);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    }, 3000);
    pc.addEventListener('icegatheringstatechange', done);
  });
}

/** A soft two-tone ring while a call is coming in. */
function startRingtone(): () => void {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    return () => undefined;
  }
  const ring = () => {
    if (!ctx) return;
    for (const [at, freq] of [
      [0, 660],
      [0.25, 880],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.2);
    }
  };
  ring();
  const timer = setInterval(ring, 2000);
  return () => {
    clearInterval(timer);
    void ctx?.close();
    ctx = null;
  };
}

/**
 * In-app voice calls over the internet: no phone numbers, the voice goes browser to
 * browser. Works while GADMO is open; an alert tells the other person when it rings.
 */
export function CallPanel({
  jobId,
  live,
  who,
}: {
  jobId: string;
  live: LiveCall | null;
  /** The other person: "Pro" or "customer". */
  who: 'Pro' | 'customer';
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pc = useRef<RTCPeerConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const remoteSet = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const cleanup = useCallback((message: string | null) => {
    pc.current?.close();
    pc.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    remoteSet.current = false;
    setMuted(false);
    setPhase({ kind: 'idle' });
    setNotice(message);
  }, []);

  async function connection(): Promise<RTCPeerConnection> {
    const { iceServers } = await api<{ iceServers: RTCIceServer[] }>('/v1/calls/ice-servers');
    mic.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    const conn = new RTCPeerConnection({ iceServers });
    for (const track of mic.current.getTracks()) conn.addTrack(track, mic.current);
    conn.ontrack = (e) => {
      if (audio.current) audio.current.srcObject = e.streams[0] ?? null;
    };
    pc.current = conn;
    return conn;
  }

  function failed(err: unknown, fallback: string) {
    const text =
      err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access was not allowed. Allow it to make calls.'
        : err instanceof ApiError
          ? err.message
          : fallback;
    cleanup(text);
  }

  async function call() {
    setNotice(null);
    if (!navigator.mediaDevices?.getUserMedia || !('RTCPeerConnection' in window)) {
      setNotice('This browser can’t make calls.');
      return;
    }
    setPhase({ kind: 'connecting', callId: '' });
    try {
      const conn = await connection();
      await conn.setLocalDescription(await conn.createOffer());
      await gathered(conn);
      const res = await post<{ call: CallView }>(`/v1/jobs/${jobId}/calls`, {
        sdp: conn.localDescription!.sdp,
      });
      setPhase({ kind: 'calling', callId: res.call.id });
    } catch (err) {
      failed(err, 'The call could not start. Try again.');
    }
  }

  async function answer() {
    const p = phaseRef.current;
    if (p.kind !== 'incoming') return;
    setPhase({ kind: 'connecting', callId: p.callId });
    try {
      const conn = await connection();
      await conn.setRemoteDescription({ type: 'offer', sdp: p.offer });
      await conn.setLocalDescription(await conn.createAnswer());
      await gathered(conn);
      await post(`/v1/calls/${p.callId}/answer`, { sdp: conn.localDescription!.sdp });
      setPhase({ kind: 'active', callId: p.callId, since: Date.now() });
    } catch (err) {
      await post(`/v1/calls/${p.callId}/end`).catch(() => undefined);
      failed(err, 'The call could not connect.');
    }
  }

  async function hangUp(action: 'end' | 'decline') {
    const p = phaseRef.current;
    if (p.kind === 'idle' || !('callId' in p) || !p.callId) return cleanup(null);
    await post(`/v1/calls/${p.callId}/${action}`).catch(() => undefined);
    cleanup(action === 'decline' ? 'Call declined.' : null);
  }

  // A call ringing for us, seen by the chat's own polling.
  useEffect(() => {
    if (phase.kind !== 'idle' || live?.status !== 'RINGING' || live.you !== 'CALLEE') return;
    let stale = false;
    api<{ call: CallView | null }>(`/v1/jobs/${jobId}/calls/current`)
      .then(({ call: c }) => {
        if (!stale && c?.status === 'RINGING' && c.you === 'CALLEE' && c.offerSdp) {
          setNotice(null);
          setPhase({ kind: 'incoming', callId: c.id, offer: c.offerSdp });
        }
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [live, phase.kind, jobId]);

  // While a call is on: follow it every second (this also tells GADMO we're still here).
  const callId = 'callId' in phase && phase.callId ? phase.callId : null;
  useEffect(() => {
    if (!callId) return;
    const timer = setInterval(async () => {
      try {
        const { call: c } = await api<{ call: CallView | null }>(`/v1/jobs/${jobId}/calls/current`);
        if (!c || c.id !== callId) return cleanup('The call ended.');
        if (c.status === 'MISSED')
          return cleanup(c.you === 'CALLER' ? 'No answer.' : 'Missed call.');
        if (c.status === 'DECLINED') return cleanup(`Your ${who} can’t talk right now.`);
        if (c.status === 'ENDED') return cleanup('Call ended.');
        if (c.status === 'ACTIVE' && c.you === 'CALLER' && c.answerSdp && !remoteSet.current) {
          remoteSet.current = true;
          await pc.current?.setRemoteDescription({ type: 'answer', sdp: c.answerSdp });
          setPhase({ kind: 'active', callId, since: Date.now() });
        }
      } catch {
        // Try again next second.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [callId, jobId, who, cleanup]);

  // Ring while a call comes in; tick the call clock.
  useEffect(() => (phase.kind === 'incoming' ? startRingtone() : undefined), [phase.kind]);
  useEffect(() => {
    if (phase.kind !== 'active') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase.kind]);

  // Leaving the page hangs up.
  useEffect(() => {
    const leave = () => {
      const p = phaseRef.current;
      if ('callId' in p && p.callId) {
        void fetch(`/v1/calls/${p.callId}/end`, {
          method: 'POST',
          keepalive: true,
          credentials: 'same-origin',
          headers: { 'x-gadmo-client': 'web' },
        });
      }
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      pc.current?.close();
      mic.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function toggleMute() {
    const next = !muted;
    mic.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }

  const clock = (since: number) => {
    const s = Math.max(0, Math.floor((now - since) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="call-panel">
      <audio ref={audio} autoPlay />
      {phase.kind === 'idle' && (
        <button className="button button-quiet button-small" type="button" onClick={call}>
          📞 Call your {who}
        </button>
      )}
      {phase.kind === 'connecting' && (
        <p className="call-status" role="status">
          Connecting…
        </p>
      )}
      {phase.kind === 'calling' && (
        <div className="call-box">
          <p className="call-status" role="status">
            Calling your {who}…
          </p>
          <button
            className="button button-quiet button-small"
            type="button"
            onClick={() => hangUp('end')}
          >
            Cancel
          </button>
        </div>
      )}
      {phase.kind === 'incoming' && (
        <div className="call-box call-incoming">
          <p className="call-status" role="status">
            Your {who} is calling
          </p>
          <div className="fee-actions">
            <button className="button button-small" type="button" onClick={answer}>
              Answer
            </button>
            <button
              className="button button-quiet button-small"
              type="button"
              onClick={() => hangUp('decline')}
            >
              Decline
            </button>
          </div>
        </div>
      )}
      {phase.kind === 'active' && (
        <div className="call-box call-active">
          <p className="call-status" role="status">
            On call · {clock(phase.since)}
          </p>
          <div className="fee-actions">
            <button className="button button-quiet button-small" type="button" onClick={toggleMute}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              className="button button-small button-danger"
              type="button"
              onClick={() => hangUp('end')}
            >
              Hang up
            </button>
          </div>
        </div>
      )}
      {notice && phase.kind === 'idle' && <p className="meta call-notice">{notice}</p>}
    </div>
  );
}
