/**
 * Applies prisma/sql/constraints.sql after a migration.
 *
 * Runs `pg` directly rather than shelling out to `psql`: psql is not present
 * on every developer machine (notably Windows without a full Postgres
 * install), and the file contains a dollar-quoted PL/pgSQL body that a naive
 * statement splitter would break. pg's simple query protocol executes the
 * whole file in one round trip, quoting intact.
 *
 * This is an ops script that runs outside the API process, so it reads
 * DATABASE_URL directly instead of going through src/config/env.ts —
 * getEnv() demands the full application environment (JWT secrets, vault key),
 * none of which a migration needs.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const sqlPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'prisma',
  'sql',
  'constraints.sql',
);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env, or export it.');
  process.exit(1);
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query(readFileSync(sqlPath, 'utf8'));
  console.log(`Applied ${sqlPath}`);
} catch (error) {
  console.error('Failed to apply constraints:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end();
}
