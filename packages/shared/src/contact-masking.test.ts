import { describe, expect, it } from 'vitest';
import { MASK_TOKEN, maskContactInfo } from './contact-masking';

describe('maskContactInfo — phone numbers and bank accounts', () => {
  it.each([
    'call 08031234567',
    'my line is 0803 123 4567',
    'reach me +234 803 123 4567',
    'number: 0803-123-4567',
    '0.8.0.3.1.2.3.4.5.6.7',
    'O8O3 l23 4567',
    'zero eight zero three one two three four five six seven',
    'pay into 0123456789 GTBank',
  ])('hides digits in "%s"', (input) => {
    const result = maskContactInfo(input);
    expect(result.masked).toBe(true);
    expect(result.reasons).toContain('phone_or_account');
    expect(result.text).toContain(MASK_TOKEN);
    expect(result.text).not.toMatch(/\d{4}/);
  });

  it.each([
    'The quote is ₦25,000 for labour',
    'I will come at 10:30 tomorrow',
    'Need 3 bags of cement and 2 tins of paint',
    'Total is 1,500,000 naira',
    'Job number 4521',
  ])('leaves normal job talk alone: "%s"', (input) => {
    const result = maskContactInfo(input);
    expect(result.masked).toBe(false);
    expect(result.text).toBe(input);
  });
});

describe('maskContactInfo — emails, links and handles', () => {
  it('hides a plain email', () => {
    const result = maskContactInfo('email me on musa.fix@gmail.com please');
    expect(result.text).toBe(`email me on ${MASK_TOKEN} please`);
    expect(result.reasons).toContain('email');
  });

  it('hides an obfuscated email', () => {
    const result = maskContactInfo('musa at gmail dot com');
    expect(result.reasons).toContain('email');
    expect(result.text).not.toContain('gmail');
  });

  it.each([
    'https://wa.me/2348031234567',
    'www.musafix.com',
    'wa.me/2348031234567',
    'musafix.com.ng',
  ])('hides link %s', (input) => {
    const result = maskContactInfo(`see ${input}`);
    expect(result.reasons).toContain('link');
    expect(result.text).not.toContain(input);
  });

  it('hides a social handle but keeps the sentence', () => {
    const result = maskContactInfo('follow me @musa_fixes on IG');
    expect(result.text).toBe(`follow me ${MASK_TOKEN} on IG`);
    expect(result.reasons).toContain('handle');
  });
});

describe('maskContactInfo — off-platform intent', () => {
  it('flags without hiding when someone asks to move to WhatsApp', () => {
    const result = maskContactInfo('Abeg send your number make we talk for WhatsApp');
    expect(result.flagged).toBe(true);
    expect(result.masked).toBe(false);
    expect(result.reasons).toContain('contact_intent');
  });

  it('does not flag a normal message', () => {
    const result = maskContactInfo('I have arrived at the gate');
    expect(result.flagged).toBe(false);
    expect(result.reasons).toEqual([]);
  });
});
