/**
 * GADMO chat rule: customers and Pros must never exchange contact details.
 * maskContactInfo() hides phone numbers, bank account numbers, emails, links
 * and social handles before a message is stored or delivered, and flags
 * messages that try to move the conversation off GADMO.
 */

export type MaskReason = 'phone_or_account' | 'email' | 'link' | 'handle' | 'contact_intent';

export interface MaskResult {
  text: string;
  /** True when anything in the message was hidden. */
  masked: boolean;
  /** True when the message should be counted toward the sender's review score. */
  flagged: boolean;
  reasons: MaskReason[];
}

export const MASK_TOKEN = '[hidden by GADMO]';

/** Phones are 10–13 digits, NUBAN accounts are 10; prices with commas are never joined. */
const MIN_DIGITS_TO_MASK = 10;

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/** Characters people put between digits to dodge filters ("0803-123 4567", "0.8.0.3"). */
const DIGIT_SEPARATOR = /^[\s\-._/()+*|]+$/;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const OBFUSCATED_EMAIL =
  /\b[\w.+-]+\s*[([]?\s*at\s*[)\]]?\s*[\w-]+\s*[([]?\s*dot\s*[)\]]?\s*(?:com|ng|net|org|co)\b/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
const SHORT_LINK = /\b(?:wa\.me|t\.me|bit\.ly|linktr\.ee|ig\.me|m\.me)\/?\S*/gi;
const BARE_DOMAIN = /\b[a-z0-9-]+\.(?:com|net|org|io|co|me)(?:\.ng)?\b|\b[a-z0-9-]+\.ng\b/gi;
const HANDLE = /(^|[\s,;:])@[A-Za-z0-9_.]{3,}/g;
const CONTACT_INTENT =
  /\b(?:whats\s?app|watsapp|instagram|insta|telegram|facebook|snapchat|tiktok|call me|my number|my line|phone number|send (?:me )?your (?:number|line)|account number|acct no|opay|palmpay|moniepoint|pay me directly|outside (?:the )?app|off (?:the )?app)\b/i;

function digitsOf(token: string): string | null {
  if (/^\d+$/.test(token)) return token;
  const word = NUMBER_WORDS[token.toLowerCase()];
  if (word) return word;
  // Letter look-alikes mixed with digits: "O8O3", "o8o3l2".
  if (/\d/.test(token) && /^[\doOlI]+$/.test(token)) {
    return token.replace(/[oO]/g, '0').replace(/[lI]/g, '1');
  }
  return null;
}

function maskDigitRuns(text: string): { text: string; hit: boolean } {
  const tokens = text.match(/[A-Za-z0-9]+|[^A-Za-z0-9]+/g) ?? [];
  let out = '';
  let hit = false;
  // Pending run: everything since the first digit-like token.
  let run = '';
  let runDigits = 0;
  let trailingSeparator = '';

  const flush = () => {
    if (runDigits >= MIN_DIGITS_TO_MASK) {
      out += MASK_TOKEN + trailingSeparator;
      hit = true;
    } else {
      out += run + trailingSeparator;
    }
    run = '';
    runDigits = 0;
    trailingSeparator = '';
  };

  for (const token of tokens) {
    const digits = /[A-Za-z0-9]/.test(token) ? digitsOf(token) : null;
    if (digits !== null) {
      run += trailingSeparator + token;
      trailingSeparator = '';
      runDigits += digits.length;
    } else if (run && DIGIT_SEPARATOR.test(token)) {
      trailingSeparator += token;
    } else {
      if (run) flush();
      out += token;
    }
  }
  if (run) flush();
  return { text: out, hit };
}

export function maskContactInfo(input: string): MaskResult {
  const reasons = new Set<MaskReason>();
  let text = input;

  const replace = (pattern: RegExp, reason: MaskReason, keepPrefix = false) => {
    text = text.replace(pattern, (match: string, prefix?: string) => {
      reasons.add(reason);
      return keepPrefix && typeof prefix === 'string' ? prefix + MASK_TOKEN : MASK_TOKEN;
    });
  };

  replace(EMAIL, 'email');
  replace(OBFUSCATED_EMAIL, 'email');
  replace(URL, 'link');
  replace(SHORT_LINK, 'link');
  replace(BARE_DOMAIN, 'link');
  replace(HANDLE, 'handle', true);

  const digits = maskDigitRuns(text);
  text = digits.text;
  if (digits.hit) reasons.add('phone_or_account');

  if (CONTACT_INTENT.test(input)) reasons.add('contact_intent');

  const masked = [...reasons].some((r) => r !== 'contact_intent');
  return { text, masked, flagged: reasons.size > 0, reasons: [...reasons] };
}
