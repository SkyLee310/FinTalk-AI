/**
 * One-off production data migration script to rename demo accounts from
 * @fintalk.test to @fintalk.ai.
 *
 * Safe and idempotent:
 * - Renames existing @fintalk.test emails in the User table to @fintalk.ai.
 * - Ensures all standard demo accounts exist with valid password hashes.
 * - Never wired into automated deploy hooks; run manually when needed.
 */
import 'dotenv/config';
import pg from 'pg';
import argon2 from 'argon2';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Exiting.');
  process.exit(1);
}

const DEMO_PASSWORD = 'Demo!2345';
const client = new pg.Client({ connectionString });

try {
  await client.connect();
  console.log('Connected to database.');

  // 1. Rename existing @fintalk.test emails to @fintalk.ai
  const renameResult = await client.query(`
    UPDATE "User"
    SET email = REPLACE(email, '@fintalk.test', '@fintalk.ai')
    WHERE email LIKE '%@fintalk.test';
  `);
  console.log(`Renamed ${renameResult.rowCount} user email(s) from @fintalk.test to @fintalk.ai.`);

  // 2. Ensure all standard demo accounts exist and are active
  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const demoUsers = [
    { email: 'maker@fintalk.ai', displayName: 'Demo Maker', role: 'MAKER', canViewMeetings: false, canViewAuditTrail: false },
    { email: 'checker@fintalk.ai', displayName: 'Demo Checker', role: 'CHECKER', canViewMeetings: false, canViewAuditTrail: false },
    { email: 'shariah@fintalk.ai', displayName: 'Demo Shariah', role: 'SHARIAH', canViewMeetings: false, canViewAuditTrail: false },
    { email: 'oversight@fintalk.ai', displayName: 'Demo Oversight', role: 'OVERSIGHT', canViewMeetings: true, canViewAuditTrail: true },
    { email: 'admin@fintalk.ai', displayName: 'Demo Admin', role: 'ADMIN', canViewMeetings: false, canViewAuditTrail: false },
  ];

  for (const u of demoUsers) {
    await client.query(`
      INSERT INTO "User" (id, email, "passwordHash", "displayName", role, "canViewMeetings", "canViewAuditTrail", "accountStatus")
      VALUES (
        'usr_' || substr(md5(random()::text), 1, 16),
        $1, $2, $3, $4::"Role", $5, $6, 'ACTIVE'
      )
      ON CONFLICT (email) DO UPDATE SET
        "passwordHash" = EXCLUDED."passwordHash",
        "displayName" = EXCLUDED."displayName",
        role = EXCLUDED.role,
        "canViewMeetings" = EXCLUDED."canViewMeetings",
        "canViewAuditTrail" = EXCLUDED."canViewAuditTrail",
        "accountStatus" = 'ACTIVE',
        "deactivatedAt" = NULL;
    `, [u.email, passwordHash, u.displayName, u.role, u.canViewMeetings, u.canViewAuditTrail]);
  }

  console.log('All demo accounts verified and ready at @fintalk.ai.');
} catch (err) {
  console.error('Error during demo email migration:', err);
  process.exit(1);
} finally {
  await client.end();
}
