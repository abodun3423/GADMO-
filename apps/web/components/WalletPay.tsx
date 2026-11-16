'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/money';

/**
 * Money in the customer's GADMO wallet (refunds) pays first, unless they untick it to keep
 * it for a bank withdrawal (founder decision, November 2026). If it covers everything, the
 * payment is made at once; otherwise the card pays the rest.
 */
export function useWalletPay(amountKobo: number, enabled = true) {
  const [balance, setBalance] = useState(0);
  const [useWallet, setUseWallet] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api<{ wallet: { balanceKobo: number } }>('/v1/wallet')
      .then((r) => live && setBalance(r.wallet.balanceKobo))
      .catch(() => live && setBalance(0));
    return () => {
      live = false;
    };
  }, [enabled]);

  const fromWallet = useWallet ? Math.min(balance, amountKobo) : 0;
  const byCard = amountKobo - fromWallet;
  return {
    /** Sent with the pay request. */
    body: { useWallet },
    /** "Pay ₦2,000": what the button says. */
    label:
      fromWallet === 0
        ? `Pay ${money(amountKobo)}`
        : byCard === 0
          ? `Pay ${money(amountKobo)} from my wallet`
          : `Pay ${money(byCard)} by card`,
    /** The tick box, shown only when there is money in the wallet. */
    choice:
      balance > 0 && amountKobo > 0 ? (
        <label className="wallet-choice">
          <input
            type="checkbox"
            checked={useWallet}
            onChange={(e) => setUseWallet(e.target.checked)}
          />
          <span>
            Use {money(Math.min(balance, amountKobo))} from my GADMO wallet
            <span className="hint">
              {useWallet
                ? byCard === 0
                  ? 'Your wallet covers it all, so no card is needed.'
                  : `Your card pays the other ${money(byCard)}.`
                : `You have ${money(balance)} in your wallet. Untick to keep it for a bank withdrawal.`}
            </span>
          </span>
        </label>
      ) : null,
  };
}
