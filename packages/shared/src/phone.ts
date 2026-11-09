/**
 * Nigerian mobile numbers have a 10-digit national number starting with
 * 70, 71, 80, 81, 90 or 91 (e.g. 0803 123 4567 → +2348031234567).
 */
const NG_MOBILE_NATIONAL = /^[789][01]\d{8}$/;

/** Normalise a Nigerian mobile number to E.164 (+234XXXXXXXXXX), or null if invalid. */
export function normalizeNigerianPhone(input: string): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/[\s\-().]/g, '');
  let national: string;
  if (/^\+234\d+$/.test(cleaned)) national = cleaned.slice(4);
  else if (/^234\d+$/.test(cleaned)) national = cleaned.slice(3);
  else if (/^0\d+$/.test(cleaned)) national = cleaned.slice(1);
  else return null;
  // Tolerate the common "+234 0803..." mistake.
  if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
  return NG_MOBILE_NATIONAL.test(national) ? `+234${national}` : null;
}

/** Safe form for logs and support screens: only the last 2 digits are visible. */
export function redactPhone(e164: string): string {
  if (e164.length < 4) return '***';
  return `${e164.slice(0, 4)}*******${e164.slice(-2)}`;
}

/**
 * Reserved demo numbers, +234 700 000 0001 to 0099. They belong to made-up accounts for
 * demos and the pilot: no SMS is ever sent to them, and they sign in with the deployment's
 * secret demo code (DEMO_LOGIN_CODE) instead.
 */
export function isDemoPhone(e164: string): boolean {
  return /^\+23470000000\d{2}$/.test(e164) && e164 !== '+2347000000000';
}
