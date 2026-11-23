import { describe, expect, it } from 'vitest';
import { wrongAccountMessage } from './guards';

describe('wrongAccountMessage', () => {
  it('says which account is needed and which one is signed in', () => {
    expect(wrongAccountMessage(['CUSTOMER'], 'ADMIN')).toBe(
      'This needs a customer account. You’re signed in as GADMO staff.',
    );
    expect(wrongAccountMessage(['PRO'], 'CUSTOMER')).toBe(
      'This needs a Pro account. You’re signed in as a customer.',
    );
    expect(wrongAccountMessage(['ADMIN', 'SUPER_ADMIN'], 'PRO')).toBe(
      'This is for GADMO staff only. You’re signed in as a Pro.',
    );
    expect(wrongAccountMessage(['CUSTOMER', 'PRO'], 'ADMIN')).toBe(
      'This needs a customer or a Pro account. You’re signed in as GADMO staff.',
    );
  });
});
