# Put GADMO online (Render, free)

This guide puts GADMO on the internet at an address like `https://gadmo-web.onrender.com`,
which anyone can open on their phone. It uses **Render's free plans only**, so it costs
nothing and needs no card for the services in `render.yaml`. Setup takes about 30 minutes,
most of it waiting for Render to build.

| Part        | What it is                              | Render plan |
| ----------- | --------------------------------------- | ----------- |
| gadmo-web   | The app people open                     | Free        |
| gadmo-api   | The API (people never open it directly) | Free        |
| gadmo-db    | PostgreSQL database                     | Free        |
| gadmo-redis | Key Value store for sign-in codes       | Free        |

**Free plan limits:**

- **It sleeps.** After 15 minutes with no visitors, the app sleeps. The next visit takes
  about a minute to wake it, so open it yourself 5 minutes before a demo, and again
  just before you present.
- **The free database is deleted after 30 days.** Recreate it, or move to a paid plan,
  before then.
- **Each workspace gets 750 free hours a month.** Sleeping services don't use any.

## Pilot mode

The free deployment runs as a **pilot**, built for demos:

- **Sign-in**: no SMS is sent. Only the demo numbers **0700 000 0001 to 0700 000 0099**
  can sign in, with the code you choose (for example `123456`). Real phone numbers see
  "Sign-in by SMS opens at launch".
- **Payments**: GADMO's own **test checkout**, the same one you used on your computer. You
  tap "Pay (test)" and no money moves. Paystack isn't needed.
- **Demo people**: 8 verified demo Pros around Ado-Ekiti, and a staff account, are added
  automatically.

| Who                | Number                                                   | Code           |
| ------------------ | -------------------------------------------------------- | -------------- |
| Tunde, electrician | 0700 000 0001                                            | your demo code |
| Other demo Pros    | 0700 000 0002 to 0008                                    | your demo code |
| A customer         | 0700 000 0050 (or 51, 52…)                               | your demo code |
| Staff              | at `/staff`: your email and password, then the demo code |                |

The first time a customer number signs in, choose "I need help".

## Steps

1. In Render, click **New → Blueprint** and choose **abodun3423/GADMO-** (your GitHub is
   already connected).
2. Render reads `render.yaml`, lists the four free parts, and asks for:
   - `WEB_ORIGIN`: `https://gadmo-web.onrender.com`
   - `DEMO_LOGIN_CODE`: 6 digits, for example `123456`
   - `DEMO_STAFF_EMAIL`: your email, for the staff sign-in
   - `DEMO_STAFF_PASSWORD`: a password of 12 or more characters for that staff account
3. Click **Apply**. The first build takes 10 to 15 minutes. When both **gadmo-web** and
   **gadmo-api** show **Live**, open gadmo-web's address on your phone.

**If Render gives a different address.** A name like `gadmo-web` may already be taken
by someone else, and then Render adds letters (for example `gadmo-web-x1y2.onrender.com`).
Then fix the two addresses:

- In **gadmo-api → Environment**, set `WEB_ORIGIN` to gadmo-web's real address.
- In **gadmo-web → Environment**, set `API_URL` to gadmo-api's real address.

Both start with `https://`. Save, and each restarts by itself.

Every push to `main` on GitHub deploys a new version automatically. Database changes and
demo people are applied each time the API starts.

## At launch: real SMS, real payments, paid plans

When GADMO is funded, nothing in the code changes. Only the Render settings do.

1. **Plans**: in `render.yaml`, change `plan: free` to `starter` for the services and Key
   Value, and to `basic-256mb` for the database (about $30 a month in total). Make
   gadmo-api a private service (`type: pserv`). gadmo-web then reaches it with
   `API_HOSTPORT` (`fromService` → `gadmo-api`, `pserv`, `hostport`) in place of `API_URL`.
   Move the database-change commands into a `preDeployCommand`.
2. **SMS**: open a Termii account and get your sender ID "GADMO" approved. Set
   `SMS_PROVIDER=termii` and `SMS_API_KEY`. Remove `DEMO_LOGIN_CODE` and the demo staff
   settings.
3. **Payments**: set `PAYMENT_PROVIDER=paystack` and your `PAYSTACK_SECRET_KEY` (`sk_live_…`
   once Paystack has verified the business). Set the Paystack webhook URL to
   `https://<your domain>/v1/payments/paystack/webhook`. The app refuses the test checkout
   once SMS is real.
4. **Push alerts**: run `npx web-push generate-vapid-keys` and set `VAPID_PUBLIC_KEY` and
   `VAPID_PRIVATE_KEY`. They are required outside the pilot.
5. **Domain**: in gadmo-web → Settings → Custom Domains, add `gadmo.ng`, then set
   `WEB_ORIGIN=https://gadmo.ng`.
6. **Calls**: add a TURN service (for example Metered or Cloudflare) and set `TURN_URLS`,
   `TURN_USERNAME` and `TURN_CREDENTIAL`, so calls connect on every mobile network.
