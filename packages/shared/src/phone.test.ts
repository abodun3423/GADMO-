import { describe, expect, it } from 'vitest';
import { normalizeNigerianPhone, redactPhone } from './phone';

describe('normalizeNigerianPhone', () => {
  it.each([
    ['08031234567', '+2348031234567'],
    ['0803 123 4567', '+2348031234567'],
    ['0803-123-4567', '+2348031234567'],
    ['+2348031234567', '+2348031234567'],
    ['2348031234567', '+2348031234567'],
    ['+234 0803 123 4567', '+2348031234567'],
    ['07061234567', '+2347061234567'],
    ['09121234567', '+2349121234567'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeNigerianPhone(input)).toBe(expected);
  });

  it.each(['', '12345', '0803123456', '080312345678', '06031234567', '+4478031234567', 'phone'])(
    'rejects %s',
    (input) => {
      expect(normalizeNigerianPhone(input)).toBeNull();
    },
  );
});

describe('redactPhone', () => {
  it('shows only the last two digits', () => {
    expect(redactPhone('+2348031234567')).toBe('+234*******67');
  });
});
