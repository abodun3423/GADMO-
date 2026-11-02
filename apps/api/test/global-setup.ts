import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { TEST_DATABASE_URL } from './test-env';

/** Recreates the test database from the migrations before the integration suite runs. */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_test'))
    throw new Error(`Refusing to reset a non-test database: ${dbName}`);

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  await runMigrations(TEST_DATABASE_URL);
  await seed(TEST_DATABASE_URL);
}
