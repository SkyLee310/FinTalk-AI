import type { PrismaClient } from '@prisma/client';
import type { TermSheetSuggestion, TranscriptionProvider } from '../ai/provider.js';
import { appendAudit } from '../audit/chain.js';
import { detectPii } from '../pdpa/detectors.js';
import { ComplianceError } from './errors.js';
import { type Actor, assertRole } from './termsheet.js';

/**
 * A maker's starting point for a term sheet: the model's read of a meeting's
 * redacted transcript and whiteboard captures. Never stored, and never
 * trusted beyond a suggestion a maker reviews before draftTermSheet
 * (termsheet.ts) writes anything real.
 *
 * Same live-call-no-persistence shape as knowledge/assistant.ts's ask(): the
 * provider runs synchronously at request time, its output is verified, and
 * only an audit entry is written — no transaction, since nothing else is
 * written alongside it.
 *
 * Verification differs from ask() in one respect. ask() discards its whole
 * answer on any PII hit, because it returns a single prose string where a
 * leak anywhere taints the lot. This returns several independent fields, and
 * only applicantName is free text a model could fill with a leaked
 * identifier — principalMyr, tenureMonths, rateBps and facilityKind /
 * islamicContract are numbers and zod-validated enums with no PII surface.
 * Discarding the whole suggestion over one risky field would throw away
 * real, safe data for no safety gain, so only applicantName is checked, and
 * only applicantName is ever dropped.
 */

export interface SuggestTermSheetDeps {
  readonly prisma: PrismaClient;
  readonly provider: TranscriptionProvider;
}

const SUGGESTIBLE_FIELDS = [
  'applicantName',
  'principalMyr',
  'tenureMonths',
  'facilityKind',
  'rateBps',
  'islamicContract',
] as const;

function assembleContext(meeting: {
  readonly transcript: { readonly rawRedacted: string } | null;
  readonly whiteboards: readonly { readonly rawRedacted: string }[];
}): string {
  const sections: string[] = [];
  if (meeting.transcript !== null && meeting.transcript.rawRedacted.trim() !== '') {
    sections.push(meeting.transcript.rawRedacted);
  }
  for (const board of meeting.whiteboards) {
    if (board.rawRedacted.trim() !== '') sections.push(board.rawRedacted);
  }
  return sections.join('\n\n---\n\n');
}

export async function suggestTermSheet(
  deps: SuggestTermSheetDeps,
  actor: Actor,
  meetingId: string,
): Promise<TermSheetSuggestion> {
  const { prisma, provider } = deps;
  assertRole(actor, 'MAKER', 'request a term sheet suggestion');

  const suggest = provider.suggestTermSheet?.bind(provider);
  if (suggest === undefined) {
    throw new ComplianceError(
      'suggestion-unavailable',
      501,
      'This deployment has no term sheet suggestion model configured.',
    );
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      transcript: { select: { rawRedacted: true } },
      whiteboards: { select: { rawRedacted: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (meeting === null) {
    throw new ComplianceError('not-found', 404, 'No meeting exists with that id.');
  }

  const redactedContext = assembleContext(meeting);
  if (redactedContext === '') {
    // Nothing captured yet to suggest from — the same "nothing to search"
    // sentinel ask() returns rather than calling a provider with no input.
    return { modelId: 'none', promptVersion: 'none' };
  }

  const raw = await suggest(redactedContext);

  const nameLeaked = raw.applicantName !== undefined && detectPii(raw.applicantName).length > 0;

  const suggestion: TermSheetSuggestion = {
    ...raw,
    applicantName: nameLeaked ? undefined : raw.applicantName,
    // Defensive: the prompt and schema already withhold islamicContract for
    // a conventional facility, but a maker reviewing these fields must never
    // see a contract name attached to a facility kind it cannot belong to.
    islamicContract: raw.facilityKind === 'ISLAMIC' ? raw.islamicContract : undefined,
  };

  await appendAudit(prisma, {
    at: new Date(),
    actorId: actor.id,
    actorRole: actor.role,
    action: 'termsheet.suggestion-requested',
    entityType: 'Meeting',
    entityId: meetingId,
    payload: {
      // Which fields the model populated, never the values — the same
      // restraint ask() applies to its answer text. A value only enters the
      // record if a maker drafts it, which termsheet.ts audits separately.
      fieldsReturned: SUGGESTIBLE_FIELDS.filter((field) => suggestion[field] !== undefined),
      nameRedacted: nameLeaked,
      modelId: suggestion.modelId,
      promptVersion: suggestion.promptVersion,
    },
  });

  return suggestion;
}
