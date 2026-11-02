/** Settings for integration tests. Uses a separate database and Redis DB so dev data is never touched. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://gadmo:gadmo_local_only@localhost:5432/gadmo_test';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  JWT_ACCESS_SECRET: 'test-only-access-secret-at-least-32-characters-long',
  OTP_PEPPER: 'test-only-otp-pepper-at-least-32-characters-long-xx',
  WEB_ORIGIN: 'http://localhost:3000',
  SMS_PROVIDER: 'console',
};
