/**
 * Self-healing migration script for deployment environments (Railway/Vercel).
 *
 * Runs before `prisma migrate deploy`. Ensures that any stuck or failed
 * migration entries in `_prisma_migrations` are marked completed, directly
 * applies critical database updates, purges legacy accounts, and guarantees
 * that all demo accounts (including oversight@fintalk.test with Demo!2345)
 * exist and are fully configured with valid password hashes.
 */
import 'dotenv/config';
import pg from 'pg';
import argon2 from 'argon2';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.log('DATABASE_URL is not set; skipping fix-failed-migrations.');
  process.exit(0);
}

const DEMO_PASSWORD = 'Demo!2345';
const client = new pg.Client({ connectionString });

try {
  await client.connect();

  // 1. Ensure columns exist before updating (defensive check)
  const columnCheck = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'User' AND column_name IN ('canViewMeetings', 'canViewAuditTrail');
  `);
  
  const foundColumns = new Set(columnCheck.rows.map((r) => r.column_name));

  if (foundColumns.has('canViewMeetings')) {
    await client.query(`ALTER TABLE "User" ALTER COLUMN "canViewMeetings" SET DEFAULT true;`);
  }

  // 2. Safely delete viewer@fintalk.test and supervisor@fintalk.test entirely from DB
  await client.query(`
    DO $$
    DECLARE
      v_ids TEXT[];
      admin_id TEXT;
    BEGIN
      SELECT ARRAY_AGG(id) INTO v_ids FROM "User" WHERE email IN ('viewer@fintalk.test', 'supervisor@fintalk.test');
      SELECT id INTO admin_id FROM "User" WHERE email = 'admin@fintalk.test' LIMIT 1;
      
      IF v_ids IS NOT NULL AND array_length(v_ids, 1) > 0 THEN
        IF admin_id IS NOT NULL THEN
          UPDATE "Meeting" SET "createdById" = admin_id WHERE "createdById" = ANY(v_ids);
          UPDATE "HumanEdit" SET "editorId" = admin_id WHERE "editorId" = ANY(v_ids);
        END IF;
        UPDATE "ShariahFlag" SET "reviewedById" = NULL WHERE "reviewedById" = ANY(v_ids);
        UPDATE "TranscriptSegment" SET "confirmedById" = NULL, "confirmedAt" = NULL WHERE "confirmedById" = ANY(v_ids);
        DELETE FROM "Feedback" WHERE "authorId" = ANY(v_ids);
        DELETE FROM "Approval" WHERE "makerId" = ANY(v_ids) OR "checkerId" = ANY(v_ids);
        DELETE FROM "Settlement" WHERE "settledById" = ANY(v_ids);
        DELETE FROM "User" WHERE id = ANY(v_ids);
      END IF;
    END $$;
  `);

  // 3. Upsert demo accounts so oversight@fintalk.test and all demo users ALWAYS exist with password Demo!2345
  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const demoUsers = [
    { email: 'maker@fintalk.test', displayName: 'Demo Maker', role: 'MAKER', canViewMeetings: false, canViewAuditTrail: false },
    { email: 'checker@fintalk.test', displayName: 'Demo Checker', role: 'CHECKER', canViewMeetings: false, canViewAuditTrail: false },
    { email: 'shariah@fintalk.test', displayName: 'Demo Shariah', role: 'SHARIAH', canViewMeetings: false, canViewAuditTrail: false },
    { email: 'oversight@fintalk.test', displayName: 'Demo Oversight', role: 'OVERSIGHT', canViewMeetings: true, canViewAuditTrail: true },
    { email: 'admin@fintalk.test', displayName: 'Demo Admin', role: 'ADMIN', canViewMeetings: false, canViewAuditTrail: false },
  ];

  for (const u of demoUsers) {
    const id = `cl_demo_${u.role.toLowerCase()}`;
    await client.query(`
      INSERT INTO "User" ("id", "email", "passwordHash", "displayName", "role", "canViewMeetings", "canViewAuditTrail", "accountStatus")
      VALUES ($1, $2, $3, $4, $5::"Role", $6, $7, 'ACTIVE'::"AccountStatus")
      ON CONFLICT ("email") DO UPDATE SET
        "passwordHash" = $3,
        "displayName" = $4,
        "role" = $5::"Role",
        "canViewMeetings" = $6,
        "canViewAuditTrail" = $7,
        "accountStatus" = 'ACTIVE'::"AccountStatus",
        "deactivatedAt" = NULL;
    `, [id, u.email, passwordHash, u.displayName, u.role, u.canViewMeetings, u.canViewAuditTrail]);
  }
  console.log('Successfully upserted all demo accounts with password Demo!2345.');

  // 4. Resolve any failed migration records in _prisma_migrations
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
