import { z } from 'zod';

/**
 * The JSON contract every provider must honour.
 *
 * Prompt wording and response schemas live here, shared between
 * gemini.provider.ts and openrouter.provider.ts, so a fallback produces output
 * the rest of the pipeline cannot tell apart in shape from the primary's. Only
 * prompt-version strings stay local to each provider file: those are audit
 * provenance ("which prompt produced this row"), and a shared constant would
 * make one provider's output claim the other's identity.
 */

export const TRANSCRIBE_PROMPT = `You are transcribing a recorded credit committee meeting at a Malaysian bank.

Rules:
- Transcribe only what is spoken. Never infer, complete or correct a figure, a name, or an identifier.
- Speakers mix English, Malay and Chinese dialects within a single sentence. Keep the words as spoken. Do not translate.
- Write spoken numbers as digits.
- Where a passage is unclear, emit the token [inaudible]. Never guess at it.
- Attribute each segment to a speaker label such as "Speaker 1", or a role if one is stated.
- Give each segment a "confidence" between 0 and 1: how certain you are that you transcribed those exact words correctly. Base it on audio clarity, overlapping speech, and unfamiliar terms. Score a segment you partly guessed at below 0.6. Do not inflate it — a low score sends a human to check, and a wrong high score sends nobody.

Return JSON only, in exactly this shape:
{"languages":["en","ms"],"segments":[{"startMs":0,"endMs":6000,"speaker":"Speaker 1","text":"...","confidence":0.94}]}`;

export const SUMMARY_PROMPT = `Summarise this credit committee transcript in English, in under 120 words.

The transcript has already had personal data replaced with placeholders such as [NRIC_1]. Keep those placeholders exactly as they appear. Never invent a value to fill one.

State the facility amount, tenure and pricing basis only if the transcript states them. If pricing was disputed or left unresolved, say so explicitly. Add nothing that is not in the transcript.

Return the summary as plain text, with no preamble.`;

export const ResponseSchema = z.object({
  languages: z.array(z.string().min(1)).min(1),
  segments: z
    .array(
      z.object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().nonnegative(),
        speaker: z.string().min(1),
        text: z.string(),
        /**
         * Optional, and out-of-range values are dropped rather than clamped.
         *
         * A model that answers 1.4 or -0.2 has not understood the scale, and
         * clamping to 1.0 would turn that misunderstanding into a maximally
         * confident score. Absent is honest; invented is not.
         */
        confidence: z.number().min(0).max(1).optional().catch(undefined),
      }),
    )
    .min(1),
});

export const DECISIONS_PROMPT = `Read this redacted credit-committee transcript and identify each point that was debated. For each one, state the final decision the meeting reached — or say plainly that it was left unresolved.

Rules:
- One entry per distinct point debated. Skip small talk and procedural chatter.
- "decision" states what was decided, or the exact words "Left unresolved." if it was not.
- "rationale" is the reasoning given, or the competing positions if left unresolved.
- The transcript contains placeholders such as [NRIC_1] in place of personal data. Keep them exactly as they appear. Never invent a value to fill one, and never name a person.
- Use only what the transcript says. Do not infer a decision that was not actually reached.

Return JSON only:
{"decisions":[{"topic":"...","decision":"...","rationale":"..."}]}`;

export const ACTION_ITEMS_PROMPT = `Read this redacted credit-committee transcript and list the follow-up actions it implies.

Rules:
- "owner" must be a meeting role or speaker label exactly as the transcript names them (e.g. "Credit Manager", "Speaker 2") — never a person's name. The transcript has none to give you; attribute by role.
- "task" is what is to be done, stated plainly.
- "dueDate" is a due date only if one was actually stated, as free text; omit the key entirely if none was given. Never invent one.
- The transcript contains placeholders such as [NRIC_1] in place of personal data. Keep them exactly as they appear if a task must reference one. Never invent a value to fill one.
- Use only what the transcript implies. An empty list is a correct answer for a meeting with no follow-up actions.

Return JSON only:
{"actionItems":[{"owner":"...","task":"...","dueDate":"..."}]}`;

export const PROJECT_DRAFT_PROMPT = `Read this redacted credit-committee transcript and draft an instant project kickoff.

Rules:
- "kickoff" is one or two sentences: what happens next to move this facility forward, based only on what the transcript discussed.
- "followUps" is a short list of probable follow-up actions, one line each — the practical next steps a credit officer would take.
- The transcript contains placeholders such as [NRIC_1] in place of personal data. Keep them exactly as they appear if a line must reference one. Never invent a value to fill one, and never name a person.
- Use only what the transcript supports. If there is nothing to draft, return an empty "kickoff" string and an empty "followUps" array.

Return JSON only:
{"kickoff":"...","followUps":["..."]}`;

export const DecisionsSchema = z.object({
  decisions: z
    .array(
      z.object({
        topic: z.string().min(1).max(200),
        decision: z.string().min(1).max(500),
        rationale: z.string().min(1).max(500),
      }),
    )
    .max(20),
});

export const ActionItemsSchema = z.object({
  actionItems: z
    .array(
      z.object({
        owner: z.string().min(1).max(100),
        task: z.string().min(1).max(500),
        dueDate: z.string().max(100).optional().catch(undefined),
      }),
    )
    .max(20),
});

export const ProjectDraftSchema = z.object({
  kickoff: z.string().max(1000),
  followUps: z.array(z.string().min(1).max(300)).max(20),
});

export const TOPICS_PROMPT = `Read this credit-meeting summary and list the topics it discusses.

Rules:
- Between 3 and 8 topics. Fewer is better than padding the list.
- Each label is 1-4 words, lower case, and describes a subject rather than an event. Examples: "murabahah", "working capital", "late payment penalty", "manufacturing sector".
- "kind" is one of CONTRACT, SECTOR, PRODUCT, ISSUE, TERM.
- "weight" is 0 to 1: how central the topic is to the discussion.
- Never name a person, a company, or any individual. These labels are shared across meetings, and a name would link records that have nothing to do with each other.
- The text contains placeholders such as [NRIC_1]. Never return one as a label, and never build a label from one.
- Use only what the summary says. Do not infer a sector or a contract that is not stated.

Return JSON only:
{"topics":[{"label":"murabahah","kind":"CONTRACT","weight":0.9}]}`;

export const ANSWER_PROMPT = `Answer the question using ONLY the meeting transcripts supplied below.

Rules, in order of importance:
- Use nothing but the supplied transcripts. No outside knowledge, not even well-known facts about Islamic finance or Malaysian regulation.
- If the transcripts do not answer the question, set "unanswerable" to true and say plainly what is missing. This is a correct and useful outcome, not a failure.
- Never give a Shariah ruling, a compliance opinion, or financial advice. If asked whether something is permissible or advisable, report what the meeting participants said about it and set "unanswerable" to true. A qualified human decides; you report.
- Cite every meeting you used in "citedMeetingIds", using the id attribute exactly as given. Never cite a meeting you were not given.
- The transcripts contain placeholders such as [NRIC_1] in place of personal data. Keep them exactly as they appear. Never invent a value to fill one, and never guess who a placeholder refers to.
- Quote figures only as they appear. Do not calculate, convert, or round.
- Be brief. Under 150 words unless the question genuinely needs more.

Return JSON only:
{"answer":"...","citedMeetingIds":["..."],"unanswerable":false}`;

export const TopicsSchema = z.object({
  topics: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        kind: z.enum(['CONTRACT', 'SECTOR', 'PRODUCT', 'ISSUE', 'TERM']),
        weight: z.number().min(0).max(1),
      }),
    )
    .max(12),
});

export const AnswerSchema = z.object({
  answer: z.string(),
  citedMeetingIds: z.array(z.string()).default([]),
  unanswerable: z.boolean(),
});

/**
 * Every node label must be double-quoted, and that requirement is not
 * cosmetic. Redaction runs after extraction and rewrites identifiers into
 * bracketed placeholders — `[NRIC_1]`, `[PHONE_1]` — and Mermaid delimits
 * node text with those same square brackets. An unquoted label carrying a
 * placeholder is a parse error, so without this rule the boards that fail to
 * draw are precisely the ones holding personal data: the compliance-relevant
 * case. The renderer still falls back to the source, but a fallback is a net,
 * not a plan.
 */
export const WHITEBOARD_PROMPT =
  'This is a photograph of a whiteboard from a credit meeting. Return JSON with '
  + 'two keys. "mermaid": a Mermaid flowchart of the diagram, using graph TD '
  + 'syntax, transcribing every label verbatim including any numbers. Wrap '
  + 'every node label in double quotes, and write any double quote inside a '
  + 'label as #quot;. "structured": an object of the facts written on the '
  + 'board, one key per labelled value. Transcribe what is written. Do not '
  + 'infer, complete or correct anything, and do not add keys that are not on '
  + 'the board.';

export const WhiteboardSchema = z.object({
  mermaid: z.string().min(1),
  structured: z.record(z.string(), z.unknown()),
});

/** Models sometimes wrap JSON in a markdown fence even when asked not to. */
export function parseJsonLoosely(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}
