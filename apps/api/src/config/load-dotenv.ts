import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Local development only: loads apps/api/.env if it exists. In production the host
 * provides real environment variables and no .env file is shipped.
 * Variables already set in the environment are never overwritten.
 */
export function loadDotEnv(): void {
  const file = path.resolve(__dirname, '../../.env');
  if (!existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  Object.assign(process.env, before);
}
