# Put GADMO online (Render)

This guide takes GADMO from your computer to a live website at an address like
`https://gadmo-web.onrender.com`, which anyone can open on their phone. It takes about 30
minutes, most of it waiting for Render to build.

The file `render.yaml` in this repository describes everything Render needs:

| Part        | What it is                                             | Render plan  | About     |
| ----------- | ------------------------------------------------------ | ------------ | --------- |
| gadmo-web   | The app people open (public)                           | Starter      | $7/month  |
| gadmo-api   | The API (private: only gadmo-web can reach it)         | Starter      | $7/month  |
| gadmo-db    | PostgreSQL database (private)                          | Basic 256 MB | $6/month  |
| gadmo-redis | Key Value store for sign-in codes and limits (private) | Starter      | $10/month |

About **$30 a month** in total, in Frankfurt (Render's closest region to Nigeria). Scale up
later from the Render dashboard without changing any code.

## Pilot mode (no SMS yet)

Until GADMO has a Termii SMS account, the deployment runs in **pilot mode**:

- Real phone numbers see "Sign-in by SMS opens at launch".
- The reserved demo numbers **0700 000 0001 to 0700 000 0099** sign in with a secret
  6-digit **demo code** that you choose. These are made-up accounts. No SMS is sent to them.
- Payments use **Paystack test mode**, so you can pay with Paystack's test cards and no real money moves.

At launch you switch to real SMS and live payments (see the end of this guide). No code
changes are needed.

## 1. Get these ready

1. **A Render account**: sign up at render.com with your GitHub account, and add a payment
   card (Billing).
2. **Your Paystack test secret key**: in the Paystack dashboard, go to Settings, then API
   Keys & Webhooks, and copy the key that starts with `sk_test_`.
3. **Web push keys**: in your Ubuntu terminal, run:
   ```bash
   npx web-push generate-vapid-keys
   ```
   Keep the _Public Key_ and _Private Key_ it prints.
4. **A demo code**: pick any 6 random digits (not 123456), for example `482915`. Anyone
   with this code can sign in to the demo accounts, so only share it with people you
   demo to.

## 2. Create everything on Render

1. In Render, click **New → Blueprint**, connect GitHub if asked, and choose
   **abodun3423/GADMO-**.
2. Render reads `render.yaml` and lists the four parts. It asks for these values:
   - `WEB_ORIGIN`: `https://gadmo-web.onrender.com`
   - `DEMO_LOGIN_CODE`: your 6 digits
   - `PAYSTACK_SECRET_KEY`: your `sk_test_...` key
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`: the two keys from step 1.3
   - `SMS_API_KEY`, `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`: leave empty for now
3. Click **Apply**. The first build takes 10 to 15 minutes. When gadmo-web shows **Live**,
   open its address.

If Render gave the web app a different address (for example `gadmo-web-x1y2.onrender.com`),
open **gadmo-api → Environment**, set `WEB_ORIGIN` to that exact address (with `https://`)
and save. The API restarts by itself.

## 3. Add the demo people and a staff account

Open **gadmo-api → Shell** in Render and run:

```bash
pnpm --filter @gadmo/api demo:data
pnpm --filter @gadmo/api admin:grant 0700 000 0099 you@example.com
```

The first command adds 8 verified demo Pros around Ado-Ekiti. The second makes a staff
account (it asks you to type a password). Staff then sign in at `/staff` with that email
and password, plus the demo code as the phone code.

## 4. Point Paystack at GADMO

In Paystack, go to Settings, then API Keys & Webhooks (Test mode). Set the **Test Webhook
URL** to:

```
https://gadmo-web.onrender.com/v1/payments/paystack/webhook
```

## 5. Try it

On your phone, open the address and sign in:

| Who           | Number                                              | Code           |
| ------------- | --------------------------------------------------- | -------------- |
| A customer    | 0700 000 0050                                       | your demo code |
| Tunde (a Pro) | 0700 000 0001                                       | your demo code |
| Staff         | /staff, your email and password, then the demo code |                |

The first time a number signs in, choose "I need help" (customer) or "I offer a skill"
(Pro). For test payments, Paystack's test card is `4084 0840 8408 4081`, any future
expiry date, CVV `408`, PIN `0000`, OTP `123456`.

Every push to `main` on GitHub deploys a new version automatically. Database changes are
applied first.

## At launch: real SMS, real payments, your own domain

1. **SMS**: open a Termii account and get your sender ID "GADMO" approved. In gadmo-api →
   Environment, set `SMS_PROVIDER=termii` and `SMS_API_KEY` to your Termii key. Also set
   `SMS_BASE_URL` if your Termii dashboard shows a different API address. Remove
   `DEMO_LOGIN_CODE` once the pilot ends.
2. **Payments**: after Paystack verifies the business, replace the key with your
   `sk_live_...` key and set the live webhook URL.
3. **Domain**: in gadmo-web → Settings → Custom Domains, add `gadmo.ng`. Render issues the
   HTTPS certificate. Then set `WEB_ORIGIN=https://gadmo.ng`.
4. **Calls**: add a TURN service (for example Metered or Cloudflare Calls) and fill the
   three `TURN_` values, so calls connect on every mobile network.
5. **Size**: move the database to a larger plan and turn on backups before real customers
   arrive.
