import { PrismaClient, type Role } from '@prisma/client';
import argon2 from 'argon2';

const DEMO_PASSWORD = 'Demo!2345';
// VIEWER and SUPERVISOR are superseded by OVERSIGHT (see auth/rbac.ts): no demo
// account is seeded for either directly. The oversight_role_backfill migration
// reassigns any real VIEWER/SUPERVISOR row onto OVERSIGHT with the equivalent
// canViewMeetings/canViewAuditTrail flags.
const ROLES: Role[] = ['MAKER', 'CHECKER', 'SHARIAH', 'OVERSIGHT', 'ADMIN'];

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

/**
 * Synthetic, like SEGMENTS above — see its comment for the vault note. A
 * second, richer fixture covering decisions, action items, the AI-drafted
 * kickoff/follow-ups, a four-type redaction log, a whiteboard capture, and
 * four distinct Shariah issue types in one example meeting.
 */
const KICKOFF_SEGMENTS = [
  { speakerLabel: 'Relationship Manager', startMs: 0, endMs: 8_000,
    textRedacted: 'Morning everyone. Today we are kicking off the Zenith Heights Industries expansion facility — RM 2,000,000 for their new plant line in Nilai, seven-year tenure. Director\'s IC is [NRIC_1] and the operating account is [BANK_ACCOUNT_1] at CIMB.' },
  { speakerLabel: 'Credit Manager', startMs: 8_000, endMs: 16_000,
    textRedacted: 'Got it. For pricing, my draft term sheet has fixed interest rate of 6.5% per annum — need Shariah sign-off before we lock that in.' },
  { speakerLabel: 'Shariah Officer', startMs: 16_000, endMs: 25_000,
    textRedacted: 'Hold on — this was pitched as an Islamic facility. Cannot use interest lah. Kena guna Murabahah profit rate structure instead, same economics, different contract.' },
  { speakerLabel: 'Risk Analyst', startMs: 25_000, endMs: 34_000,
    textRedacted: 'Noted. Also flagging the penalty clause — kalau lambat bayar past the grace period, we charge denda 1% per month on the outstanding. Need legal to confirm if that is ta\'widh or gharamah.' },
  { speakerLabel: 'Relationship Manager', startMs: 34_000, endMs: 45_000,
    textRedacted: 'One more thing from due diligence — Zenith Heights\' industrial park also leases two units to a brewery and a nightclub operator, about eight percent of group revenue. Flagging for Shariah screening before we proceed.' },
  { speakerLabel: 'Credit Manager', startMs: 45_000, endMs: 56_000,
    textRedacted: 'Understood. Final decision — we approve in principle on condition it converts to a Murabahah structure, Shariah clears the tenant-mix exposure, and legal confirms the penalty classification. Not approved as originally drafted.' },
  { speakerLabel: 'Relationship Manager', startMs: 56_000, endMs: 68_000,
    textRedacted: 'Agreed. I will redraft the term sheet under Murabahah by Friday, send it to [EMAIL_1], reach me at [PHONE_1] if there are questions. Can Shariah review by next Wednesday?' },
  { speakerLabel: 'Shariah Officer', startMs: 68_000, endMs: 74_000,
    textRedacted: 'Can. I will complete the tenant-mix screening by then.' },
  { speakerLabel: 'Risk Analyst', startMs: 74_000, endMs: 80_000,
    textRedacted: 'I will chase legal on the penalty clause — no fixed date yet, depends on their queue.' },
];

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  // Clean up legacy demo accounts entirely from the database
  const legacyUsers = await prisma.user.findMany({
    where: { email: { in: ['viewer@fintalk.test', 'supervisor@fintalk.test'] } },
    select: { id: true },
  });
  if (legacyUsers.length > 0) {
    const ids = legacyUsers.map((u) => u.id);
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (admin) {
      await prisma.meeting.updateMany({ where: { createdById: { in: ids } }, data: { createdById: admin.id } });
      await prisma.humanEdit.updateMany({ where: { editorId: { in: ids } }, data: { editorId: admin.id } });
    }
    await prisma.shariahFlag.updateMany({ where: { reviewedById: { in: ids } }, data: { reviewedById: null } });
    await prisma.transcriptSegment.updateMany({ where: { confirmedById: { in: ids } }, data: { confirmedById: null, confirmedAt: null } });
    await prisma.feedback.deleteMany({ where: { authorId: { in: ids } } });
    await prisma.approval.deleteMany({ where: { OR: [{ makerId: { in: ids } }, { checkerId: { in: ids } }] } });
    await prisma.settlement.deleteMany({ where: { settledById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  const users = await Promise.all(
    ROLES.map((role) =>
      prisma.user.upsert({
        where: { email: `${role.toLowerCase()}@fintalk.ai` },
        update: {
          displayName:
            role === 'OVERSIGHT'
              ? 'Demo Oversight'
              : `Demo ${role.charAt(0)}${role.slice(1).toLowerCase()}`,
          role,
          ...(role === 'OVERSIGHT'
            ? { canViewMeetings: true, canViewAuditTrail: true }
            : {}),
        },
        create: {
          email: `${role.toLowerCase()}@fintalk.ai`,
          passwordHash,
          displayName:
            role === 'OVERSIGHT'
              ? 'Demo Oversight'
              : `Demo ${role.charAt(0)}${role.slice(1).toLowerCase()}`,
          role,
          // Demonstrates the full OVERSIGHT surface — both grants — since
          // this is the only seed row for the role. See capabilitiesOf in
          // src/auth/rbac.ts: every other role ignores these two columns.
          ...(role === 'OVERSIGHT'
            ? { canViewMeetings: true, canViewAuditTrail: true }
            : {}),
        },
      }),
    ),
  );

  const maker = users.find((u) => u.role === 'MAKER');
  if (!maker) throw new Error('seed: MAKER user was not created');

  await seedSmeLoanMeeting(prisma, maker.id);
  await seedProjectKickoffMeeting(prisma, maker.id);
}

async function seedSmeLoanMeeting(prisma: PrismaClient, makerId: string): Promise<void> {
  const existing = await prisma.meeting.findFirst({ where: { title: { contains: 'SME' } } });
  if (existing) return;

  const meeting = await prisma.meeting.create({
    data: {
      title: 'SME Loan Approval Meeting — Tech Solutions Sdn Bhd',
      occurredAt: new Date('2026-08-07T02:30:00Z'),
      status: 'READY',
      consentConfirmed: true,
      transferAcknowledged: true,
      createdById: makerId,
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
      summaryEmbedding: [],
      followUpsRedacted: [],
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

/**
 * The richer fixture: a project-kickoff-style credit committee meeting that
 * exercises every major surface in one example — see KICKOFF_SEGMENTS above.
 */
async function seedProjectKickoffMeeting(prisma: PrismaClient, makerId: string): Promise<void> {
  const existing = await prisma.meeting.findFirst({ where: { title: { contains: 'Zenith Heights' } } });
  if (existing) return;

  const meeting = await prisma.meeting.create({
    data: {
      title: 'Project Kickoff — Zenith Heights Industries Term Financing',
      occurredAt: new Date('2026-08-12T03:00:00Z'),
      status: 'READY',
      consentConfirmed: true,
      transferAcknowledged: true,
      createdById: makerId,
    },
  });

  const rawRedacted = KICKOFF_SEGMENTS
    .map((s) => `[${s.startMs / 1000}s] ${s.speakerLabel}: ${s.textRedacted}`)
    .join('\n');

  const transcript = await prisma.transcript.create({
    data: {
      meetingId: meeting.id,
      rawRedacted,
      summaryEn:
        'Credit committee held a project-kickoff review of a proposed MYR 2,000,000 industrial expansion '
        + 'facility for Zenith Heights Industries Sdn Bhd, seven-year tenure. The facility was pitched as '
        + 'Islamic financing but the draft term sheet priced it with a conventional 6.5% per annum interest '
        + 'rate; the committee approved it in principle on condition it converts to a Murabahah structure. '
        + 'Due diligence also surfaced that the group\'s industrial park leases units to a brewery and a '
        + 'nightclub operator (about 8% of group revenue), now pending Shariah screening, and a late-payment '
        + 'penalty clause pending legal classification as ta\'widh or gharamah. The facility will not proceed '
        + 'to term sheet until both are cleared.',
      languages: ['en', 'ms'],
      modelId: 'seed-fixture',
      promptVersion: 'seed-v1',
      summaryEmbedding: [],
      segments: { create: KICKOFF_SEGMENTS },
      projectKickoffRedacted:
        'Kickoff: Zenith Heights Industries Sdn Bhd — Murabahah Term Financing Restructure. Objective: '
        + 'convert the proposed RM 2,000,000 industrial expansion facility (seven-year tenure) from a '
        + 'conventional interest structure to a Murabahah asset-backed structure, clear the tenant-mix '
        + 'Shariah exposure raised during due diligence, and finalise the late-payment clause classification '
        + 'before the facility is resubmitted to the credit committee for final approval.',
      followUpsRedacted: [
        'Relationship Manager to redraft the term sheet under a Murabahah structure by 2026-08-14.',
        'Shariah Officer to complete tenant-mix screening of the brewery and nightclub exposure by 2026-08-19.',
        'Risk Analyst to obtain legal confirmation on the late-payment clause classification.',
        'Reconvene the credit committee once Shariah clearance and legal confirmation are both received.',
      ],
    },
  });

  const nricAt = rawRedacted.indexOf('[NRIC_1]');
  const acctAt = rawRedacted.indexOf('[BANK_ACCOUNT_1]');
  const emailAt = rawRedacted.indexOf('[EMAIL_1]');
  const phoneAt = rawRedacted.indexOf('[PHONE_1]');

  await prisma.redaction.createMany({
    data: [
      { transcriptId: transcript.id, piiType: 'NRIC', placeholder: '[NRIC_1]',
        startOffset: nricAt, endOffset: nricAt + '[NRIC_1]'.length,
        detectedBy: 'regex:nric', confidence: 0.97 },
      { transcriptId: transcript.id, piiType: 'BANK_ACCOUNT', placeholder: '[BANK_ACCOUNT_1]',
        startOffset: acctAt, endOffset: acctAt + '[BANK_ACCOUNT_1]'.length,
        detectedBy: 'regex:bank-account', confidence: 0.7 },
      { transcriptId: transcript.id, piiType: 'EMAIL', placeholder: '[EMAIL_1]',
        startOffset: emailAt, endOffset: emailAt + '[EMAIL_1]'.length,
        detectedBy: 'regex:email', confidence: 0.97 },
      { transcriptId: transcript.id, piiType: 'PHONE', placeholder: '[PHONE_1]',
        startOffset: phoneAt, endOffset: phoneAt + '[PHONE_1]'.length,
        detectedBy: 'regex:phone-my', confidence: 0.9 },
    ],
  });

  await prisma.meetingDecision.createMany({
    data: [
      {
        meetingId: meeting.id,
        topic: 'Facility structure — conventional vs Murabahah',
        decision:
          'Approved in principle on condition the facility converts from a conventional interest structure '
          + 'to a Murabahah asset-backed structure at an equivalent profit rate.',
        rationale:
          'The facility was pitched as Islamic financing but the draft term sheet priced it with a '
          + 'conventional interest rate. The committee will not approve the facility as drafted; converting '
          + 'to Murabahah preserves the same economics without the Shariah conflict.',
        ordinal: 0,
      },
      {
        meetingId: meeting.id,
        topic: 'Tenant-mix Shariah exposure',
        decision:
          'Left unresolved pending Shariah screening — the facility will not proceed to term sheet until '
          + 'the brewery and nightclub tenant exposure is cleared.',
        rationale:
          'Zenith Heights\' industrial park leases units to tenants in prohibited sectors, about eight '
          + 'percent of group revenue. The committee needs a Shariah opinion on whether this disqualifies '
          + 'the group or can be ring-fenced from the financed asset before proceeding.',
        ordinal: 1,
      },
    ],
  });

  await prisma.actionItem.createMany({
    data: [
      { meetingId: meeting.id, owner: 'Relationship Manager',
        task: 'Redraft the term sheet under a Murabahah structure and circulate to the committee.',
        dueDate: '2026-08-14', ordinal: 0 },
      { meetingId: meeting.id, owner: 'Shariah Officer',
        task: 'Complete Shariah screening of the brewery and nightclub tenant-mix exposure.',
        dueDate: '2026-08-19', ordinal: 1 },
      { meetingId: meeting.id, owner: 'Risk Analyst',
        task: 'Obtain legal confirmation on whether the late payment clause is ta\'widh or gharamah.',
        dueDate: null, ordinal: 2 },
    ],
  });

  await prisma.shariahFlag.createMany({
    data: [
      {
        meetingId: meeting.id,
        issueType: 'RIBA',
        excerpt: '…my draft term sheet has fixed interest rate of 6.5% per annum — need Shariah…',
        detectedBy: 'rule:riba.interest-rate-mention',
        confidence: 0.93,
        reference: 'BNM Shariah Governance Policy — requires legal confirmation',
        status: 'FLAGGED',
      },
      {
        meetingId: meeting.id,
        issueType: 'CONTRACT_MISMATCH',
        excerpt: '…this was pitched as an Islamic facility. Cannot use interest lah. Kena guna Murabahah profit rate…',
        detectedBy: 'rule:contract-mismatch.islamic-contract-named',
        confidence: 0.6,
        reference: 'BNM Islamic contract policy documents — requires legal confirmation',
        status: 'FLAGGED',
      },
      {
        meetingId: meeting.id,
        issueType: 'LATE_PAYMENT_PENALTY',
        excerpt: '…kalau lambat bayar past the grace period, we charge denda 1% per month on the outstanding…',
        detectedBy: 'rule:late-payment.penalty-as-income',
        confidence: 0.85,
        reference: 'BNM policy on late payment charges for Islamic banking — requires legal confirmation',
        status: 'FLAGGED',
      },
      {
        meetingId: meeting.id,
        issueType: 'HARAM_SECTOR',
        excerpt: '…industrial park also leases two units to a brewery and a nightclub operator, about eight percent…',
        detectedBy: 'rule:haram-sector.prohibited-activity',
        confidence: 0.88,
        reference: 'Shariah screening of business activity — requires legal confirmation',
        status: 'FLAGGED',
      },
    ],
  });

  const mermaid =
    'graph TD;\n'
    + '  A["Zenith Heights Industries"] --> B{"Facility structure"};\n'
    + '  B -->|"Rejected: 6.5% interest p.a."| C["Conventional"];\n'
    + '  B -->|"Approved in principle"| D["Murabahah profit-rate"];\n'
    + '  D --> E["Applicant IC [NRIC_1]"];\n'
    + '  D --> F["Settlement acct [BANK_ACCOUNT_1]"];\n'
    + '  D --> G["Pending: Shariah screening of tenant mix"];\n'
    + '  D --> H["Pending: legal review of penalty clause"];';

  const structuredJson = {
    facility: 'Murabahah',
    principalMyr: '2000000',
    tenureMonths: '84',
    applicantNric: '[NRIC_1]',
    settlementAccount: '[BANK_ACCOUNT_1]',
    pendingItems: ['Shariah screening of tenant mix', 'Legal review of penalty clause'],
  };
  const structuredText = JSON.stringify(structuredJson);

  const whiteboard = await prisma.whiteboard.create({
    data: {
      meetingId: meeting.id,
      rawRedacted: `${mermaid}\n${structuredText}`,
      mermaid,
      structuredJson,
      modelId: 'seed-fixture',
      promptVersion: 'seed-whiteboard-v1',
    },
  });

  // Same redaction context in the real pipeline covers both fields, so the
  // same identifier gets the same placeholder in each — see the "one context
  // across both fields" note in whiteboards.routes.ts. That means one
  // Redaction row per occurrence: two placeholders, each appearing once in
  // the diagram and once in the structured extraction, is four rows.
  const wbNricAt = mermaid.indexOf('[NRIC_1]');
  const wbAcctAt = mermaid.indexOf('[BANK_ACCOUNT_1]');
  const base = mermaid.length + 1;
  const jsonNricAt = base + structuredText.indexOf('[NRIC_1]');
  const jsonAcctAt = base + structuredText.indexOf('[BANK_ACCOUNT_1]');

  await prisma.redaction.createMany({
    data: [
      { whiteboardId: whiteboard.id, piiType: 'NRIC', placeholder: '[NRIC_1]',
        startOffset: wbNricAt, endOffset: wbNricAt + '[NRIC_1]'.length,
        detectedBy: 'regex:nric', confidence: 0.97 },
      { whiteboardId: whiteboard.id, piiType: 'BANK_ACCOUNT', placeholder: '[BANK_ACCOUNT_1]',
        startOffset: wbAcctAt, endOffset: wbAcctAt + '[BANK_ACCOUNT_1]'.length,
        detectedBy: 'regex:bank-account', confidence: 0.7 },
      { whiteboardId: whiteboard.id, piiType: 'NRIC', placeholder: '[NRIC_1]',
        startOffset: jsonNricAt, endOffset: jsonNricAt + '[NRIC_1]'.length,
        detectedBy: 'regex:nric', confidence: 0.97 },
      { whiteboardId: whiteboard.id, piiType: 'BANK_ACCOUNT', placeholder: '[BANK_ACCOUNT_1]',
        startOffset: jsonAcctAt, endOffset: jsonAcctAt + '[BANK_ACCOUNT_1]'.length,
        detectedBy: 'regex:bank-account', confidence: 0.7 },
    ],
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
