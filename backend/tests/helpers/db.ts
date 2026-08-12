import { PrismaClient, type Role } from '@prisma/client';

export const prisma = new PrismaClient();

/** Truncate every table. AuditEntry needs the append-only triggers disabled. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEntry" DISABLE TRIGGER USER');
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditEntry", "HumanEdit", "AiOutputSnapshot", "Approval", "TermSheet",
      "ShariahFlag", "Whiteboard", "Redaction", "PiiVault", "Feedback",
      "MeetingParticipant", "TranscriptSegment", "Transcript", "Meeting", "User"
    RESTART IDENTITY CASCADE
  `);
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEntry" ENABLE TRIGGER USER');
}

export async function seedUser(role: Role) {
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}@example.test`,
      passwordHash: 'not-a-real-hash',
      displayName: role,
      role,
    },
  });
}

export async function seedMeeting(createdById: string) {
  return prisma.meeting.create({
    data: {
      title: 'Test meeting',
      occurredAt: new Date('2026-08-08T02:00:00Z'),
      createdById,
    },
  });
}
