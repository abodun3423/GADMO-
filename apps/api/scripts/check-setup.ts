/**
 * `pnpm check-setup`: checks that this computer is ready to run and test GADMO, and says how
 * to fix anything that isn't. Safe to run any time; it changes nothing.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import Redis from 'ioredis';
import { Client } from 'pg';
import { loadDotEnv } from '../src/config/load-dotenv';

const root = path.resolve(__dirname, '../../..');
let problems = 0;

function ok(text: string): void {
  console.log(`  \x1b[32m✔\x1b[0m ${text}`);
}
function bad(text: string, fix: string): void {
  problems++;
  console.log(`  \x1b[31m✘\x1b[0m ${text}\n      → ${fix.split('\n').join('\n        ')}`);
}
function warn(text: string, fix: string): void {
  console.log(`  \x1b[33m!\x1b[0m ${text}\n      → ${fix.split('\n').join('\n        ')}`);
}
function run(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}
function portUser(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}

async function main(): Promise<void> {
  console.log('\nGADMO check-setup: checking this computer\n');

  console.log('Computer');
  const wsl =
    existsSync('/proc/version') && /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
  if (process.platform === 'win32') {
    bad(
      'Running in Windows, not Ubuntu',
      'In VS Code: press F1 → "WSL: Connect to WSL", then open the gadmo- folder inside Ubuntu.',
    );
  } else {
    ok(wsl ? 'Ubuntu on Windows (WSL)' : `${process.platform}`);
  }
  if (root.startsWith('/mnt/')) {
    warn(
      `The project is on the Windows drive (${root}); it runs slowly there`,
      'Clone it inside Ubuntu instead: cd ~ && git clone https://github.com/abodun3423/GADMO-.git gadmo-',
    );
  } else {
    ok(`Project folder: ${root}`);
  }

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) ok(`Node.js ${process.versions.node}`);
  else bad(`Node.js ${process.versions.node} is too old`, 'nvm install 22 && nvm use 22');
  const pnpm = run('pnpm --version');
  if (pnpm?.startsWith('10.')) ok(`pnpm ${pnpm}`);
  else
    bad(
      `pnpm ${pnpm ?? 'not found'}`,
      'corepack enable && corepack prepare pnpm@10.28.0 --activate',
    );

  console.log('\nSettings');
  const envFile = path.join(root, 'apps/api/.env');
  if (existsSync(envFile)) ok('apps/api/.env exists');
  else bad('apps/api/.env is missing', 'pnpm setup:local');
  loadDotEnv();
  const dbUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;

  console.log('\nServices (Postgres and Redis)');
  const docker = run('docker info --format "{{.ServerVersion}}"');
  if (docker) ok(`Docker ${docker}`);
  else
    warn(
      'Docker isn’t reachable from Ubuntu',
      'Start Docker Desktop, and in its Settings → Resources → WSL integration, turn on Ubuntu.\n(Skip this if you run your own Postgres and Redis.)',
    );

  let dbNow: Date | null = null;
  if (dbUrl) {
    const db = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 4000 });
    try {
      await db.connect();
      const r = await db.query<{ now: Date }>('select now()');
      dbNow = r.rows[0]!.now;
      ok('Postgres is running');
      const journal = JSON.parse(
        readFileSync(path.join(root, 'apps/api/drizzle/meta/_journal.json'), 'utf8'),
      ) as { entries: unknown[] };
      const applied = await db
        .query<{ n: string }>('select count(*) as n from drizzle.__drizzle_migrations')
        .then((x) => Number(x.rows[0]!.n))
        .catch(() => 0);
      if (applied >= journal.entries.length) ok(`Database is up to date (${applied} migrations)`);
      else
        bad(
          `Database is behind: ${journal.entries.length - applied} migration(s) not applied`,
          'pnpm update:local',
        );
      const seeded = await db
        .query<{ n: string }>('select count(*) as n from categories')
        .then((x) => Number(x.rows[0]!.n))
        .catch(() => 0);
      if (seeded > 0) ok(`Service catalogue loaded (${seeded} entries)`);
      else bad('The service catalogue is empty', 'pnpm --filter @gadmo/api db:seed');
    } catch {
      bad('Postgres isn’t reachable', 'pnpm services:up');
    } finally {
      await db.end().catch(() => undefined);
    }
  }

  let redisNow: Date | null = null;
  if (redisUrl) {
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 4000,
      maxRetriesPerRequest: 0,
    });
    redis.on('error', () => undefined);
    try {
      await redis.connect();
      const [secs, micros] = await redis.time();
      redisNow = new Date(Number(secs) * 1000 + Math.floor(Number(micros) / 1000));
      ok('Redis is running');
    } catch {
      bad('Redis isn’t reachable', 'pnpm services:up');
    } finally {
      redis.disconnect();
    }
  }

  console.log('\nClock');
  const now = new Date();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  ok(
    `Ubuntu time: ${now.toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} (Lagos), zone ${zone}`,
  );
  const drift = (d: Date | null) => (d ? Math.abs(d.getTime() - now.getTime()) / 1000 : 0);
  const worst = Math.max(drift(dbNow), drift(redisNow));
  if (worst > 30) {
    bad(
      `The database clock is ${Math.round(worst)} seconds away from Ubuntu’s: login codes and chat times will misbehave`,
      'In Windows PowerShell: wsl --shutdown   then restart Docker Desktop and VS Code.\nIf it keeps happening: wsl --update',
    );
  } else {
    ok('Ubuntu, Postgres and Redis clocks agree');
  }

  console.log('\nPorts');
  for (const [port, what, start] of [
    [4000, 'API', 'pnpm dev'],
    [3000, 'web app', 'pnpm dev'],
  ] as const) {
    if (await portUser(port)) {
      warn(
        `Port ${port} (${what}) is already in use`,
        `If GADMO isn’t running, something else holds it: ss -ltnp | grep ${port}  then  kill <pid>`,
      );
    } else {
      ok(`Port ${port} (${what}) is free for ${start}`);
    }
  }

  console.log('\nBrowser tests');
  const browsers =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    path.join(process.env.HOME ?? '', '.cache/ms-playwright');
  if (existsSync(browsers) && run(`ls ${browsers} | grep -c chromium`))
    ok('Playwright Chromium installed');
  else
    warn(
      'Playwright’s Chromium isn’t installed (only needed for pnpm test:e2e)',
      'pnpm --filter @gadmo/web exec playwright install --with-deps chromium',
    );

  console.log(
    problems === 0
      ? '\n\x1b[32mAll set.\x1b[0m Start GADMO with: pnpm dev   (then open http://localhost:3000)\n'
      : `\n\x1b[31m${problems} thing(s) to fix\x1b[0m: run the command after each ✘, then pnpm check-setup again.\n`,
  );
  process.exit(problems === 0 ? 0 : 1);
}

void main();
