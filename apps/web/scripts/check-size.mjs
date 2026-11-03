#!/usr/bin/env node
/**
 * PWA weight budget (PRD section 6): first-load JavaScript must stay under 200 KB gzipped.
 * Starts the production build, loads each page, adds up the gzipped size of every script
 * the page asks for, and fails if any page is over budget.
 *
 * Usage: pnpm --filter @gadmo/web build && pnpm --filter @gadmo/web check:size
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 200;
const PORT = Number(process.env.SIZE_CHECK_PORT ?? 3999);
const PAGES = [
  '/',
  '/signin',
  '/request?service=plumber',
  '/jobs',
  '/account',
  '/pro',
  '/pro/profile',
];
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://127.0.0.1:${PORT}`;

const server = spawn('node_modules/.bin/next', ['start', '-p', String(PORT)], {
  cwd: webDir,
  stdio: 'ignore',
  env: { ...process.env, NODE_ENV: 'production' },
});

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${base}/offline`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Next.js did not start');
}

const gzCache = new Map();
async function gzippedSize(src) {
  if (gzCache.has(src)) return gzCache.get(src);
  const local = src.startsWith('/_next/static/')
    ? path.join(webDir, '.next', 'static', src.slice('/_next/static/'.length).split('?')[0])
    : null;
  const body = local
    ? await readFile(local)
    : Buffer.from(await (await fetch(base + src)).arrayBuffer());
  const size = gzipSync(body, { level: 9 }).length;
  gzCache.set(src, size);
  return size;
}

let failed = false;
try {
  await waitForServer();
  console.log(`First-load JavaScript (gzipped), budget ${BUDGET_KB} KB per page:`);
  for (const page of PAGES) {
    const html = await (await fetch(base + page)).text();
    const srcs = new Set(
      [
        ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
        ...html.matchAll(/<link[^>]+rel="preload"[^>]+as="script"[^>]+href="([^"]+)"/g),
      ]
        .map((m) => m[1])
        .filter((s) => s.startsWith('/')),
    );
    let total = 0;
    for (const src of srcs) total += await gzippedSize(src);
    const kb = total / 1024;
    const ok = kb <= BUDGET_KB;
    if (!ok) failed = true;
    console.log(`  ${ok ? '✔' : '✘'} ${page.padEnd(28)} ${kb.toFixed(1)} KB (${srcs.size} files)`);
  }
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
