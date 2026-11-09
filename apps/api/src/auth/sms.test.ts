import { describe, expect, it } from 'vitest';
import { TermiiSmsSender } from './sms';

describe('TermiiSmsSender', () => {
  it('posts the message to Termii without the plus sign', async () => {
    const calls: { url: string; body: Record<string, string> }[] = [];
    const fake = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const sms = new TermiiSmsSender('key-1', 'GADMO', 'https://api.ng.termii.com', 'dnd', fake);
    await sms.send('+2348031234567', 'Your GADMO code is 123456.');
    expect(calls).toEqual([
      {
        url: 'https://api.ng.termii.com/api/sms/send',
        body: {
          api_key: 'key-1',
          to: '2348031234567',
          from: 'GADMO',
          sms: 'Your GADMO code is 123456.',
          type: 'plain',
          channel: 'dnd',
        },
      },
    ]);
  });

  it('fails without logging the message when Termii refuses', async () => {
    const fake = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const sms = new TermiiSmsSender('bad', 'GADMO', 'https://api.ng.termii.com', 'dnd', fake);
    await expect(sms.send('+2348031234567', 'code 123456')).rejects.toThrow(
      'SMS could not be sent',
    );
  });
});
