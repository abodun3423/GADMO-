# Run and test GADMO on Windows (VS Code + Ubuntu)

This guide sets up GADMO on a Windows PC using VS Code with an Ubuntu (WSL) terminal. You do it once.
After that, the daily routine at the end is all you need.

Everything below runs in the **Ubuntu terminal inside VS Code**, unless a step says PowerShell.

## 1. One-time Windows setup

1. Install **WSL with Ubuntu**. In PowerShell (as administrator): `wsl --install -d Ubuntu`, then
   restart the PC and create your Ubuntu user name and password when asked.
2. Keep WSL up to date (this also fixes most clock problems). In PowerShell: `wsl --update`.
3. Install **Docker Desktop**. In Docker Desktop → Settings → Resources → WSL integration, turn on
   **Ubuntu**, then Apply & restart.
4. Install **VS Code** and its **WSL** extension (`ms-vscode-remote.remote-wsl`).
5. Set the Windows time zone to **(UTC+01:00) West Central Africa** with "Set time automatically"
   on. GADMO uses Nigerian time, and a wrong PC clock makes sign-in codes expire early.

## 2. Get the code into Ubuntu

Keep the project inside Ubuntu's own folders (`~/…`), **not** under `/mnt/c/…`. Windows folders are
very slow from Ubuntu and break file watching.

Open VS Code, press `Ctrl+Shift+P` → **WSL: Connect to WSL**, then open a terminal (`` Ctrl+` ``):

```bash
cd ~
git clone https://github.com/abodun3423/GADMO-.git
cd GADMO-
code .
```

VS Code reopens on the project (the bottom-left corner says **WSL: Ubuntu**). Accept the
**recommended extensions** it offers (ESLint, Prettier, Playwright, Vitest, Docker).

If you already have a copy under `/mnt/c/...` with your `apps/api/.env` in it, copy that file over:
`cp /mnt/c/path/to/old/GADMO-/apps/api/.env ~/GADMO-/apps/api/.env`.

## 3. Install Node 22 and pnpm (in Ubuntu)

```bash
sudo apt update && sudo apt install -y curl git build-essential
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22
corepack enable
corepack prepare pnpm@10.28.0 --activate
node -v   # v22.x
pnpm -v   # 10.28.0
```

## 4. First run

```bash
pnpm install
pnpm services:up     # starts Postgres and Redis in Docker and waits until they are ready
pnpm setup:local     # creates apps/api/.env with fresh secrets, migrates and seeds the database
pnpm check-setup     # checks everything below; fix anything marked ✘ before going on
pnpm dev             # starts the API (port 4000) and the app (port 3000) together
```

Open http://localhost:3000 in your Windows browser. Login codes are printed in the terminal where
`pnpm dev` runs (look for `[OTP]`). Stop everything with `Ctrl+C`.

To test the browser tests once, also install the test browser:

```bash
pnpm --filter @gadmo/web exec playwright install --with-deps chromium
```

## 5. Daily routine

```bash
git pull
pnpm update:local    # new packages, database changes and service catalogue after every pull
pnpm services:up     # if Docker was restarted
pnpm dev
```

## 6. Testing

| What                                              | Command                 |
| ------------------------------------------------- | ----------------------- |
| Is my setup healthy?                              | `pnpm check-setup`      |
| Everything CI checks (format, lint, types, tests) | `pnpm check`            |
| Browser tests on a phone-sized screen             | `pnpm test:e2e`         |
| Only the unit tests                               | `pnpm test`             |
| Only the API tests against the real database      | `pnpm test:integration` |

The same commands are in VS Code under **Terminal → Run Task…** (they all start with "GADMO:").
The Testing panel (flask icon) runs single unit or browser tests.

The API tests use a separate `gadmo_test` database, so they never touch your own test accounts.

## 7. When something goes wrong

Run `pnpm check-setup` first: it names the problem and the fix. The common ones:

- **"Docker is not reachable"**: start Docker Desktop and check WSL integration for Ubuntu is on,
  then `pnpm services:up`.
- **Clock drift / sign-in codes expire at once / chat messages out of order**: in PowerShell run
  `wsl --shutdown`, restart Docker Desktop, then reopen VS Code. If it keeps happening, run
  `wsl --update`. While you develop you can also add `DEV_LOGIN_CODE=123456` to `apps/api/.env`
  to always sign in with that code (it is refused outside development).
- **"Port 4000 (or 3000) is in use"**: an old `pnpm dev` is still running. Close other terminals,
  or find it with `ss -ltnp | grep 4000` and stop it with `kill <pid>`.
- **"Too many attempts" when signing in**: wait for the time shown, or have GADMO staff reset
  sign-in limits for that user.
- **Migrations not applied** after a pull: `pnpm update:local`.
- **Paystack test payments**: put `PAYMENT_PROVIDER=paystack` and your `PAYSTACK_SECRET_KEY=sk_test_...`
  in `apps/api/.env` yourself. Never paste keys into chat or commit them.
