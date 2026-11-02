#!/usr/bin/env node
/**
 * Creates apps/api/.env for local development from .env.example, filling in fresh random
 * secrets. Works on Windows, macOS and Linux (no openssl needed). Never overwrites an
 * existing .env file.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'apps', 'api', '.env');

if (existsSync(target)) {
  console.log('apps/api/.env already exists — leaving it unchanged.');
  process.exit(0);
}

const secret = () => randomBytes(48).toString('base64url');
const filled = {
  JWT_ACCESS_SECRET: secret(),
  OTP_PEPPER: secret(),
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

const text = readFileSync(path.join(root, '.env.example'), 'utf8')
  .split(/\r?\n/)
  .map((line) => {
    const key = line.split('=')[0];
    return key && key in filled && line.trim() === `${key}=` ? `${key}=${filled[key]}` : line;
  })
  .join('\n');

writeFileSync(target, text, { mode: 0o600 });
console.log(
  'Created apps/api/.env with new local secrets. Keep this file private; it is git-ignored.',
);
