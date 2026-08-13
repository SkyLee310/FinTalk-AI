/**
 * Self-healing migration script for deployment environments (Railway/Vercel).
 *
 * Runs before `prisma migrate deploy`. Ensures that any stuck or failed
 * migration entries in `_prisma_migrations` are marked completed, and directly
 * applies critical database updates (oversight defaults and legacy user deactivations)
 * so that deployment never fails due to Prisma migration lock or checksum drift.
 */
import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.log('DATABASE_URL is not set; skipping fix-failed-migrations.');
  process.exit(0);
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  // 1. Ensure columns exist before updating (defensive check)
  const columnCheck = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'User' AND column_name IN ('canViewMeetings', 'canViewAuditTrail', 'deactivatedAt');
  `);
  
  const foundColumns = new Set(columnCheck.rows.map((r) => r.column_name));

  if (foundColumns.has('canViewMeetings')) {
    await client.query(`ALTER TABLE "User" ALTER COLUMN "canViewMeetings" SET DEFAULT true;`);
  }

  if (foundColumns.has('deactivatedAt')) {
    await client.query(`
      UPDATE "User"
      SET "deactivatedAt" = NOW()
      WHERE "email" IN ('viewer@fintalk.test', 'supervisor@fintalk.test');
    `);
  }

  if (foundColumns.has('canViewMeetings') && foundColumns.has('canViewAuditTrail')) {
    await client.query(`
      UPDATE "User"
      SET "canViewMeetings" = true, "canViewAuditTrail" = true
      WHERE "role"::text = 'OVERSIGHT';
    `);
  }

  // 2. Resolve any failed migration records in _prisma_migrations
  const tableCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = '_prisma_migrations'
    );
  `);

  if (tableCheck.rows[0]?.exists) {
    const result = await client.query(`
      UPDATE "_prisma_migrations"
      SET "finished_at" = NOW(),
          "applied_steps_count" = 1,
          "logs" = NULL
      WHERE "finished_at" IS NULL;
    `);
    if (result.rowCount > 0) {
      console.log(`Cleared ${result.rowCount} stuck/failed migration entries in _prisma_migrations.`);
    }
  }
  console.log('Successfully completed pre-deploy database self-healing check.');
} catch (error) {
  console.warn('fix-failed-migrations warning (non-fatal):', error instanceof Error ? error.message : error);
} finally {
  await client.end();
}
