'use client';

import { useRef } from 'react';

/**
 * A short numeric code typed into one box per digit (like a bank PIN). Typing moves to
 * the next box, Backspace to the previous one, and pasting fills them all.
 */
export function CodeBoxes({
  length,
  value,
  onChange,
  label,
  autoFocus = false,
}: {
  length: number;
  value: string;
  onChange: (code: string) => void;
  /** Read out for each box: "<label>, digit 1 of 4". */
  label: string;
  autoFocus?: boolean;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function setFrom(index: number, typed: string) {
    const clean = typed.replace(/\D/g, '');
    if (!clean) return;
    const next = digits.slice();
    for (let i = 0; i < clean.length && index + i < length; i++) next[index + i] = clean[i]!;
    onChange(next.join('').slice(0, length));
    boxes.current[Math.min(index + clean.length, length - 1)]?.focus();
  }

  return (
    <div className="code-boxes" role="group" aria-label={label}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          className="code-box"
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          aria-label={`${label}, digit ${i + 1} of ${length}`}
          autoFocus={autoFocus && i === 0}
          value={d}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setFrom(i, e.target.value.slice(-length))}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              const next = digits.slice();
              if (next[i]) {
                next[i] = '';
              } else if (i > 0) {
                next[i - 1] = '';
                boxes.current[i - 1]?.focus();
              }
              onChange(next.join(''));
            } else if (e.key === 'ArrowLeft' && i > 0) {
              boxes.current[i - 1]?.focus();
            } else if (e.key === 'ArrowRight' && i < length - 1) {
              boxes.current[i + 1]?.focus();
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            setFrom(i, e.clipboardData.getData('text'));
          }}
        />
      ))}
    </div>
  );
}
