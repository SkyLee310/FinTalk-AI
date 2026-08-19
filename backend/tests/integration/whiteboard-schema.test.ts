import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb, seedMeeting, seedUser } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

async function freshWhiteboard() {
  const user = await seedUser('MAKER');
  const meeting = await seedMeeting(user.id);
  return prisma.whiteboard.create({
    data: {
      meetingId: meeting.id,
      rawRedacted: 'Director [NRIC_1] approves',
      mermaid: 'graph TD;A-->B;',
      structuredJson: { nodes: ['A', 'B'] },
      modelId: 'test-fixture',
      promptVersion: 'v1',
    },
  });
}

describe('Redaction parentage', () => {
  it('accepts a redaction owned by a whiteboard', async () => {
    const whiteboard = await freshWhiteboard();

    const row = await prisma.redaction.create({
      data: {
        whiteboardId: whiteboard.id,
        piiType: 'NRIC',
        placeholder: '[NRIC_1]',
        startOffset: 9,
        endOffset: 17,
        detectedBy: 'regex:nric',
        confidence: 0.99,
      },
    });

    expect(row.transcriptId).toBeNull();
    expect(row.whiteboardId).toBe(whiteboard.id);
  });

  /**
   * A redaction with no parent is an orphaned claim that some personal data was
   * accounted for, with nothing to reconcile it against.
   */
  it('refuses a redaction with no parent', async () => {
    await expect(prisma.redaction.create({
      data: {
        piiType: 'NRIC',
        placeholder: '[NRIC_1]',
        startOffset: 0,
        endOffset: 8,
        detectedBy: 'regex:nric',
        confidence: 0.99,
      },
    })).rejects.toThrow(/redaction_single_parent/);
  });

  it('refuses a redaction claiming both parents', async () => {
    const whiteboard = await freshWhiteboard();
    const transcript = await prisma.transcript.create({
      data: {
        meetingId: whiteboard.meetingId,
        rawRedacted: 'x',
        summaryEn: 'x',
        languages: ['en'],
        modelId: 'test-fixture',
        promptVersion: 'v1',
        summaryEmbedding: [],
        followUpsRedacted: [],
      },
    });

    await expect(prisma.redaction.create({
      data: {
        transcriptId: transcript.id,
        whiteboardId: whiteboard.id,
        piiType: 'NRIC',
        placeholder: '[NRIC_1]',
        startOffset: 0,
        endOffset: 8,
        detectedBy: 'regex:nric',
        confidence: 0.99,
      },
    })).rejects.toThrow(/redaction_single_parent/);
  });

  it('cascades to redactions when the whiteboard is deleted', async () => {
    const whiteboard = await freshWhiteboard();
    await prisma.redaction.create({
      data: {
        whiteboardId: whiteboard.id,
        piiType: 'NRIC',
        placeholder: '[NRIC_1]',
        startOffset: 9,
        endOffset: 17,
        detectedBy: 'regex:nric',
        confidence: 0.99,
      },
    });

    await prisma.whiteboard.delete({ where: { id: whiteboard.id } });
    expect(await prisma.redaction.count()).toBe(0);
  });

  /**
   * The existing transcript path must keep working unchanged. transcriptId went
   * nullable to make room for whiteboards, and a nullable column is exactly the
   * kind of loosening that quietly stops enforcing what it used to.
   */
  it('still accepts a redaction owned by a transcript', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    const transcript = await prisma.transcript.create({
      data: {
        meetingId: meeting.id,
        rawRedacted: 'Director [NRIC_1] approves',
        summaryEn: 'Approved',
        languages: ['en', 'ms'],
        modelId: 'test-fixture',
        promptVersion: 'v1',
        summaryEmbedding: [],
        followUpsRedacted: [],
      },
    });

    const row = await prisma.redaction.create({
      data: {
        transcriptId: transcript.id,
        piiType: 'NRIC',
        placeholder: '[NRIC_1]',
        startOffset: 9,
        endOffset: 17,
        detectedBy: 'regex:nric',
        confidence: 0.99,
      },
    });

    expect(row.whiteboardId).toBeNull();
    expect(row.transcriptId).toBe(transcript.id);
  });
});
