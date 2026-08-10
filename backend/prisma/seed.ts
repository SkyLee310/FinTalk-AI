import { PrismaClient, type Role } from '@prisma/client';
import argon2 from 'argon2';

const DEMO_PASSWORD = 'Demo!2345';
const ROLES: Role[] = ['VIEWER', 'MAKER', 'CHECKER', 'SHARIAH', 'SUPERVISOR', 'ADMIN'];

/**
 * All content below is synthetic. The NRIC placeholder stands in for a value
 * that in production would live encrypted in PiiVault — the seed deliberately
 * stores no vault row, because there is no real identifier to protect.
 */
const SEGMENTS = [
  { speakerLabel: 'Credit Officer', startMs: 0, endMs: 6_000,
    textRedacted: 'Okay boss, we nak discuss the SME working capital facility for SME Tech Solutions.' },
  { speakerLabel: 'Credit Manager', startMs: 6_000, endMs: 14_000,
    textRedacted: 'Amount berapa? I think RM 50,000 cukup for their expansion, tenure five years.' },
  { speakerLabel: 'Credit Officer', startMs: 14_000, endMs: 22_000,
    textRedacted: 'Betul. Director punya IC is [NRIC_1], account [BANK_ACCOUNT_1] at Maybank.' },
  { speakerLabel: 'Credit Manager', startMs: 22_000, endMs: 31_000,
    textRedacted: 'For the pricing, we quote fixed interest rate of 8% per annum lah.' },
  { speakerLabel: 'Shariah Officer', startMs: 31_000, endMs: 40_000,
    textRedacted: 'Wait — kalau Islamic facility, cannot pakai interest. Kena guna Murabahah profit rate.' },
];

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  const users = await Promise.all(
    ROLES.map((role) =>
      prisma.user.upsert({
        where: { email: `${role.toLowerCase()}@fintalk.test` },
        update: {},
        create: {
          email: `${role.toLowerCase()}@fintalk.test`,
          passwordHash,
          displayName: `Demo ${role}`,
          role,
        },
      }),
    ),
  );

  const maker = users.find((u) => u.role === 'MAKER');
  if (!maker) throw new Error('seed: MAKER user was not created');

  const existing = await prisma.meeting.findFirst({ where: { title: { contains: 'SME' } } });
  if (existing) return;

  const meeting = await prisma.meeting.create({
    data: {
      title: 'SME Loan Approval Meeting — Tech Solutions Sdn Bhd',
      occurredAt: new Date('2026-08-07T02:30:00Z'),
      status: 'READY',
      consentConfirmed: true,
      transferAcknowledged: true,
      createdById: maker.id,
    },
  });

  const rawRedacted = SEGMENTS
    .map((s) => `[${s.startMs / 1000}s] ${s.speakerLabel}: ${s.textRedacted}`)
    .join('\n');

  const transcript = await prisma.transcript.create({
    data: {
      meetingId: meeting.id,
      rawRedacted,
      summaryEn:
        'Credit committee discussed a MYR 50,000 SME working capital facility for Tech Solutions Sdn Bhd '
        + 'over a five-year tenure. Pricing was initially quoted as an 8% per annum interest rate; the Shariah '
        + 'officer objected that an Islamic facility requires a Murabahah profit rate instead. '
        + 'Pricing basis is unresolved.',
      languages: ['en', 'ms'],
      modelId: 'seed-fixture',
      promptVersion: 'seed-v1',
      segments: { create: SEGMENTS },
    },
  });

  const nricAt = rawRedacted.indexOf('[NRIC_1]');
  const acctAt = rawRedacted.indexOf('[BANK_ACCOUNT_1]');

  await prisma.redaction.createMany({
    data: [
      { transcriptId: transcript.id, piiType: 'NRIC', placeholder: '[NRIC_1]',
        startOffset: nricAt, endOffset: nricAt + '[NRIC_1]'.length,
        detectedBy: 'regex:nric', confidence: 0.99 },
      { transcriptId: transcript.id, piiType: 'BANK_ACCOUNT', placeholder: '[BANK_ACCOUNT_1]',
        startOffset: acctAt, endOffset: acctAt + '[BANK_ACCOUNT_1]'.length,
        detectedBy: 'regex:bank-account', confidence: 0.95 },
    ],
  });

  await prisma.shariahFlag.create({
    data: {
      meetingId: meeting.id,
      issueType: 'RIBA',
      excerpt: 'fixed interest rate of 8% per annum',
      detectedBy: 'rule:riba.interest-rate-mention',
      confidence: 0.93,
      reference: 'BNM Shariah Governance Policy — requires legal confirmation',
      status: 'FLAGGED',
    },
  });
}

// Allow `npm run db:seed`.
if (process.argv[1]?.endsWith('seed.ts')) {
  const prisma = new PrismaClient();
  seedDatabase(prisma)
    .then(() => { console.log('Seed complete.'); })
    .catch((err: unknown) => { console.error(err); process.exit(1); })
    .finally(() => void prisma.$disconnect());
}
