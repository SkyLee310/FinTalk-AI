import type { PrismaClient } from '@prisma/client';
import type { GroundingExcerpt, TranscriptionProvider } from '../ai/provider.js';
import { appendAudit, type AuditActor } from '../audit/chain.js';
import { ComplianceError } from '../compliance/errors.js';
import { detectPii } from '../pdpa/detectors.js';
import { rankBySimilarity } from './graph.js';
import { keywordQuery, rankByKeyword } from './keyword.js';

/**
 * Ask FinTalk AI — questions answered from this corpus, and from nothing else.
 *
 * Four rules govern this file, and each exists because breaking it would turn a
 * search tool into the thing the rest of the product spends its design refusing to
 * be.
 *
 * **1. The vault is never opened.** Retrieval reads `Transcript.rawRedacted`, so
 * the assistant sees `[NRIC_1]` exactly as the summariser does. Answering "whose IC
 * was discussed" is not a feature to add carefully — it is a different product, and
 * it would route a decryption through a text box.
 *
 * **2. It answers only from what it retrieved.** A model asked about Murabahah with
 * no grounding will happily explain Murabahah, and a plausible paragraph with no
 * meeting behind it is indistinguishable from one that has. Worse, "is this
 * compliant?" answered from general knowledge is the AI issuing a Shariah ruling —
 * which the spec forbids and the SHARIAH role exists to prevent.
 *
 * **3. Every answer cites, or says it found nothing.** An uncited claim cannot be
 * checked, and this corpus is credit-committee evidence.
 *
 * **4. The output is checked for identifiers.** The model was handed placeholders,
 * so any identifier in its answer was invented or carried in from elsewhere —
 * either way it must not reach a screen.
 */

/** How many meetings to read for one question. */
const RETRIEVAL_LIMIT = 5;

/** Per-meeting excerpt cap, so one long transcript cannot crowd out the rest. */
const EXCERPT_CHARS = 6_000;

export interface AskHistoryTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AskInput {
  readonly question: string;
  readonly actor: AuditActor;
  /**
   * Prior turns in this chat session, oldest first. Optional and capped by
   * the route (`AskBody.history`, max 10) — this function accepts whatever
   * it is given and does not re-enforce the cap, so the limit lives in
   * exactly one place.
   *
   * Explicitly `| undefined` because this project runs with
   * `exactOptionalPropertyTypes`: the route's zod-parsed `history` is typed
   * `T[] | undefined` (present-but-undefined, not an absent key), and both
   * mean "no history" here.
   */
  readonly history?: readonly AskHistoryTurn[] | undefined;
}

/**
 * Folds prior turns and a new question into one string for retrieval and
 * generation, so a follow-up ("what about the second one?") can resolve
 * against what was actually asked and answered before it.
 *
 * Deliberately just a string transform: `TranscriptionProvider.embed` and
 * `.answerFromContext` keep their existing single-string signatures, so
 * neither `gemini.provider.ts` nor `fake.provider.ts` changes for this.
 *
 * Returns `question` unchanged when there is no history, so a first turn is
 * byte-identical to today's single-turn behavior.
 */
export function withHistory(question: string, history?: readonly AskHistoryTurn[]): string {
  if (history === undefined || history.length === 0) {
    return question;
  }

  const transcript = history
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');

  return `Earlier in this conversation:\n${transcript}\n\nNew question: ${question}`;
}

export interface Citation {
  readonly meetingId: string;
  readonly title: string;
  readonly occurredAt: string;
  /**
   * What put this meeting in the retrieval set: cosine similarity under
   * semantic retrieval, the share of query terms matched under keyword
   * retrieval. Read it against `AskResult.retrieval` — the two scales are not
   * comparable, and 0.5 means something different in each.
   */
  readonly score: number;
}

export interface AskResult {
  readonly answer: string;
  readonly citations: readonly Citation[];
  /** True when the corpus does not answer the question. `answer` says so plainly. */
  readonly unanswerable: boolean;
  readonly modelId: string;
  readonly promptVersion: string;
  /**
   * Which retrieval produced these citations.
   *
   * `keyword` means semantic retrieval was unavailable or matched nothing, so
   * these meetings share words with the question rather than meaning. Carried
   * to the caller because passing term overlap off as semantic search would
   * overstate how the answer was found.
   */
  readonly retrieval: 'semantic' | 'keyword';
}

export interface AssistantDeps {
  readonly prisma: PrismaClient;
  readonly provider: TranscriptionProvider;
}

/**
 * Cosine ranking, or an empty list.
 *
 * Every way this can fail — no embedding model bound, the model refusing, no
 * stored embedding close enough — reduces to one fact for the caller: semantic
 * retrieval produced no candidates, so try the other path. Returning empty
 * rather than throwing is what lets that decision live in one place.
 */
async function rankSemantically(
  embed: ((text: string) => Promise<readonly number[]>) | undefined,
  composite: string,
  transcripts: readonly { readonly meetingId: string; readonly summaryEmbedding: number[] }[],
): Promise<readonly { readonly meetingId: string; readonly score: number }[]> {
  if (embed === undefined) return [];

  try {
    const queryVector = await embed(composite);
    return rankBySimilarity(
      queryVector,
      transcripts.map((t) => ({ meetingId: t.meetingId, embedding: t.summaryEmbedding })),
      RETRIEVAL_LIMIT,
    );
  } catch {
    return [];
  }
}

export async function ask(deps: AssistantDeps, input: AskInput): Promise<AskResult> {
  const { prisma, provider } = deps;
  const question = input.question.trim();

  if (question.length < 3) {
    throw new ComplianceError(
      'question-too-short',
      422,
      'Ask a question of at least a few words.',
    );
  }

  /**
   * A question carrying personal data is refused, not searched.
   *
   * Searching for a raw NRIC would mean matching it against text where that value
   * has been replaced by a placeholder — so it could never match, and the user
   * would have typed an identifier into a request log for nothing. Refusing
   * explains why, and keeps the identifier out of the audit entry below.
   */
  const found = detectPii(question);
  if (found.length > 0) {
    const kinds = [...new Set(found.map((f) => f.kind))].sort().join(', ');
    throw new ComplianceError(
      'question-contains-personal-data',
      422,
      `Remove the personal data from your question (${kinds}). Transcripts store `
      + 'placeholders rather than identifiers, so searching for the value itself '
      + 'cannot match anything — ask about the facility or the topic instead.',
    );
  }

  // Bound once: `?.` gives no narrowing across an await, and a bare reference
  // would lose `this`.
  const embed = provider.embed?.bind(provider);
  const answerFromContext = provider.answerFromContext?.bind(provider);

  /**
   * Only the text model is required.
   *
   * Without it there is nothing that can compose an answer, and saying so is
   * the honest response. A missing embedding model is a different situation:
   * retrieval degrades to keyword matching below and the question still gets
   * answered, so refusing on that alone disabled a working feature over one
   * absent environment variable.
   */
  if (answerFromContext === undefined) {
    throw new ComplianceError(
      'assistant-unavailable',
      501,
      'This deployment has no assistant model configured.',
    );
  }

  const transcripts = await prisma.transcript.findMany({
    // Same archivedAt gap as buildGraph() in graph.ts: an archived meeting
    // must stop being answerable, not just stop being listed.
    where: { meeting: { status: 'READY', archivedAt: null } },
    select: {
      meetingId: true,
      rawRedacted: true,
      summaryEmbedding: true,
      meeting: { select: { title: true, occurredAt: true } },
    },
  });

  if (transcripts.length === 0) {
    return {
      answer: 'There are no transcripts to search yet. Capture a meeting first.',
      citations: [],
      unanswerable: true,
      modelId: 'none',
      promptVersion: 'none',
      retrieval: 'semantic',
    };
  }

  // Retrieval and generation see the history-folded composite, so a
  // follow-up resolves against prior turns; the length check above, the PII
  // refusal above, and the audit payload below all use the raw `question` —
  // a reformulated string is a retrieval device, not what the user asked.
  const composite = withHistory(question, input.history);

  /**
   * Semantic retrieval first, keyword retrieval when it comes back empty.
   *
   * Two situations used to end the request here, and neither was the asker's
   * fault. A deployment with no embedding model configured refused every
   * question outright — one absent variable disabling the whole feature. And a
   * meeting captured before embeddings were configured has an empty
   * `summaryEmbedding`, which `rankBySimilarity` scores at zero and drops, so
   * it stayed permanently unreachable even once a model *was* configured.
   *
   * Falling back keeps the corpus answerable in both. The two paths are not
   * equivalent, so `retrieval` travels with the result rather than letting term
   * overlap read as semantic search — and it is recorded in the audit entry
   * below, which is where an operator can see that a deployment has been
   * quietly serving the weaker path.
   */
  let retrieval: 'semantic' | 'keyword' = 'semantic';
  let ranked = await rankSemantically(embed, composite, transcripts);

  if (ranked.length === 0) {
    retrieval = 'keyword';
    // Not `composite` — see keywordQuery. The model's own prior prose would
    // otherwise outweigh the question in a term-overlap score.
    ranked = rankByKeyword(
      keywordQuery(question, input.history),
      transcripts.map((t) => ({ meetingId: t.meetingId, text: t.rawRedacted })),
      RETRIEVAL_LIMIT,
    );
  }

  if (ranked.length === 0) {
    return {
      answer:
        'No stored meeting matches this question. Try naming the facility, the '
        + 'contract type, or a term you would expect to hear in the discussion.',
      citations: [],
      unanswerable: true,
      modelId: 'none',
      promptVersion: 'none',
      retrieval,
    };
  }

  const byId = new Map(transcripts.map((t) => [t.meetingId, t]));

  const excerpts: GroundingExcerpt[] = ranked.flatMap((scored) => {
    const transcript = byId.get(scored.meetingId);
    if (transcript === undefined) return [];
    return [{
      meetingId: scored.meetingId,
      // Already redacted — the whole reason the vault is never touched.
      text: transcript.rawRedacted.slice(0, EXCERPT_CHARS),
    }];
  });

  const answer = await answerFromContext(composite, excerpts);

  /**
   * Citations are intersected with what was actually supplied.
   *
   * A model can cite an id it was never given, and a fabricated citation is worse
   * than none because it looks like provenance. Only ids present in the retrieval
   * set survive, and the score comes from our own ranking rather than from the
   * model's claim about relevance.
   */
  const supplied = new Map(ranked.map((r) => [r.meetingId, r.score]));
  const citations: Citation[] = answer.citedMeetingIds
    .filter((id) => supplied.has(id))
    .flatMap((id) => {
      const transcript = byId.get(id);
      const score = supplied.get(id);
      if (transcript === undefined || score === undefined) return [];
      return [{
        meetingId: id,
        title: transcript.meeting.title,
        occurredAt: transcript.meeting.occurredAt.toISOString(),
        score,
      }];
    });

  /**
   * An answer claiming to be grounded but citing nothing is treated as
   * unanswerable.
   *
   * That combination means the model either found no support or did not say where
   * its support came from, and in both cases presenting the prose as an answer
   * would lend it authority it has not earned.
   */
  const unanswerable = answer.unanswerable || citations.length === 0;

  /**
   * The model's text is checked for identifiers before it is returned.
   *
   * It was handed placeholders, so anything matching here was invented or carried
   * in from elsewhere. Fail closed rather than patch it: a silently-repaired answer
   * hides a model producing personal data from redacted input, which is a fault
   * worth surfacing rather than smoothing over. The same reasoning governs the
   * summariser in process-meeting.ts.
   */
  const leaked = detectPii(answer.answer);
  if (leaked.length > 0) {
    const kinds = [...new Set(leaked.map((f) => f.kind))].sort().join(', ');
    throw new ComplianceError(
      'answer-contains-personal-data',
      500,
      `The assistant produced personal data (${kinds}) from redacted input, so the `
      + 'answer was discarded. That is a fault in the system, not a limit of your '
      + 'question.',
    );
  }

  /**
   * Audited outside a transaction, because nothing was written to audit *with*.
   *
   * The question and the meetings read are recorded so an auditor can see what was
   * asked of the corpus and what it was answered from. The answer text is not
   * stored: this is a read view rather than a meeting artifact, and keeping
   * generated prose in an append-only log would give it a permanence the product
   * never claims for it.
   */
  await appendAudit(prisma, {
    at: new Date(),
    actorId: input.actor.id,
    actorRole: input.actor.role,
    action: 'assistant.queried',
    entityType: 'Corpus',
    entityId: 'knowledge',
    payload: {
      // Safe to store: refused above if it carried personal data.
      question,
      retrievedMeetingIds: ranked.map((r) => r.meetingId),
      citedMeetingIds: citations.map((c) => c.meetingId),
      unanswerable,
      // How those meetings were found, not just which. An auditor rereading
      // this entry cannot otherwise tell whether the answer rested on meaning
      // or on shared words.
      retrieval,
      modelId: answer.modelId,
      promptVersion: answer.promptVersion,
    },
  });

  return {
    answer:
      unanswerable && answer.answer.trim() === ''
        ? 'The stored meetings do not answer that question.'
        : answer.answer,
    citations,
    unanswerable,
    modelId: answer.modelId,
    promptVersion: answer.promptVersion,
    retrieval,
  };
}
