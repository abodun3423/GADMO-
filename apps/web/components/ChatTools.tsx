'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, fieldMessage, post, postBlob } from '@/lib/api';
import { shrinkPhoto } from '@/lib/photo';
import type { ChatMessage } from '@/lib/types';

const VOICE_SECONDS = 60;

type Sent = (message: ChatMessage) => void;
type Failed = (text: string) => void;

function reason(err: unknown, fallback: string): string {
  return fieldMessage(err) ?? (err instanceof ApiError ? err.message : fallback);
}

/** What a photo, voice note or location pin looks like in the chat. */
export function MessageBody({ jobId, message }: { jobId: string; message: ChatMessage }) {
  if (message.kind === 'PHOTO' && message.fileId) {
    const src = `/v1/jobs/${jobId}/files/${message.fileId}`;
    return (
      <a href={src} target="_blank" rel="noopener" className="bubble-photo">
        <img src={src} alt={message.mine ? 'Your photo' : 'Photo'} loading="lazy" />
      </a>
    );
  }
  if (message.kind === 'VOICE' && message.fileId) {
    return (
      <audio
        className="bubble-audio"
        controls
        preload="none"
        src={`/v1/jobs/${jobId}/files/${message.fileId}`}
        aria-label={message.mine ? 'Your voice note' : 'Voice note'}
      />
    );
  }
  if (message.kind === 'LOCATION' && message.latitude !== null && message.longitude !== null) {
    const query = `${message.latitude.toFixed(6)},${message.longitude.toFixed(6)}`;
    return (
      <span className="bubble-text">
        📍 {message.mine ? 'You shared a location.' : 'Shared a location.'}{' '}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${query}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in Maps
        </a>
      </span>
    );
  }
  return <span className="bubble-text">{message.body}</span>;
}

/** Photo, voice note and location buttons above the message box. */
export function ChatTools({
  jobId,
  onSent,
  onError,
}: {
  jobId: string;
  onSent: Sent;
  onError: Failed;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function sendPhoto(file: File | undefined) {
    if (!file) return;
    setBusy('Sending photo…');
    try {
      const photo = await shrinkPhoto(file, 1600);
      const res = await postBlob<{ message: ChatMessage }>(
        `/v1/jobs/${jobId}/messages/photo`,
        photo,
      );
      onSent(res.message);
    } catch (err) {
      onError(reason(err, 'The photo was not sent. Try again.'));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function shareLocation() {
    if (!('geolocation' in navigator)) {
      onError('This device can’t share its location.');
      return;
    }
    setBusy('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await post<{ message: ChatMessage }>(`/v1/jobs/${jobId}/messages/location`, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          onSent(res.message);
        } catch (err) {
          onError(reason(err, 'Your location was not sent. Try again.'));
        } finally {
          setBusy(null);
        }
      },
      () => {
        setBusy(null);
        onError('Location was not shared. Allow location access and try again.');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }

  return (
    <div className="chat-tools">
      <input
        ref={fileRef}
        id="chat-photo"
        className="sr-only"
        type="file"
        accept="image/*"
        onChange={(e) => void sendPhoto(e.target.files?.[0])}
      />
      <label htmlFor="chat-photo" className="button button-quiet button-small">
        📷 Photo
      </label>
      <VoiceNote jobId={jobId} onSent={onSent} onError={onError} />
      <button
        className="button button-quiet button-small"
        type="button"
        onClick={shareLocation}
        disabled={busy !== null}
      >
        📍 Location
      </button>
      {busy && (
        <span className="meta" role="status">
          {busy}
        </span>
      )}
    </div>
  );
}

/** Tap to record (up to a minute), then send or cancel. */
function VoiceNote({ jobId, onSent, onError }: { jobId: string; onSent: Sent; onError: Failed }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const keep = useRef(true);

  useEffect(() => {
    if (seconds === null) return;
    if (seconds >= VOICE_SECONDS) {
      recorder.current?.stop();
      return;
    }
    const t = setTimeout(() => setSeconds((s) => (s === null ? null : s + 1)), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  useEffect(() => () => recorder.current?.stop(), []);

  async function start() {
    if (!('MediaRecorder' in window) || !navigator.mediaDevices?.getUserMedia) {
      onError('This browser can’t record voice notes.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError('Microphone access was not allowed. Allow it to send voice notes.');
      return;
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const rec = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 32_000,
    });
    const chunks: Blob[] = [];
    keep.current = true;
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setSeconds(null);
      if (!keep.current || chunks.length === 0) return;
      const type = (rec.mimeType || mimeType || 'audio/webm').split(';')[0]!;
      setSending(true);
      try {
        const res = await postBlob<{ message: ChatMessage }>(
          `/v1/jobs/${jobId}/messages/voice`,
          new Blob(chunks, { type }),
        );
        onSent(res.message);
      } catch (err) {
        onError(reason(err, 'The voice note was not sent. Try again.'));
      } finally {
        setSending(false);
      }
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
  }

  function stop(send: boolean) {
    keep.current = send;
    recorder.current?.stop();
  }

  if (seconds !== null) {
    const clock = `0:${String(seconds).padStart(2, '0')}`;
    return (
      <span className="voice-recording">
        <span className="recording-dot" aria-hidden="true" />
        <span role="status">Recording {clock}</span>
        <button className="button button-small" type="button" onClick={() => stop(true)}>
          Send voice note
        </button>
        <button
          className="button button-quiet button-small"
          type="button"
          onClick={() => stop(false)}
        >
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button
      className="button button-quiet button-small"
      type="button"
      onClick={start}
      disabled={sending}
    >
      {sending ? 'Sending…' : '🎤 Voice note'}
    </button>
  );
}
