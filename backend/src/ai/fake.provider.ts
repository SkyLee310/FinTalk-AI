import {
  type ActionItemDraft,
  type AudioInput,
  type DecisionDraft,
  type GroundedAnswer,
  type GroundingExcerpt,
  type TopicDraft,
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
  type WhiteboardExtraction,
} from './provider.js';

/**
 * Deterministic provider used by the test suite and by local development
 * without an API key.
 *
 * The fixture deliberately contains synthetic identifiers in the grouped forms
 * transcription really produces. A fake that returned clean text would let the
 * pipeline's redaction step pass while doing nothing.
 *
 * Every value is invented. 4111 1111 1111 1111 is the published Visa test
 * number; the NRIC and account are shape-valid and belong to no one. The same
 * NRIC appears in two segments on purpose, so a test can prove one person keeps
 * one placeholder across the whole transcript.
 */

export const FAKE_MODEL_ID = 'fake-transcriber-v1';
export const FAKE_PROMPT_VERSION = 'fake-v1';

/**
 * Confidences are spread on purpose, and two sit below the 0.6 review floor.
 *
 * A fixture where every segment scored 0.95 would let the low-confidence review
 * path pass its tests while never running — the same vacuity trap as a redaction
 * test whose input holds no identifier. The two low scores sit where a real
 * transcriber genuinely struggles: the segment reading out a digit string, and
 * the one carrying the Shariah objection in three languages at once.
 */
const FIXTURE = [
  {
    startMs: 0,
    endMs: 6_000,
    speakerLabel: 'Credit Officer',
    text: 'Okay boss, we nak discuss the SME working capital facility for Tech Solutions.',
    confidence: 0.94,
  },
  {
    startMs: 6_000,
    endMs: 14_000,
    speakerLabel: 'Credit Manager',
    text: 'Amount berapa? I think RM 50,000 cukup for their expansion, tenure five years.',
    confidence: 0.88,
  },
  {
    startMs: 14_000,
    endMs: 22_000,
    speakerLabel: 'Credit Officer',
    text: 'Betul. Director punya IC is 880101-14-5678, account 1234 5678 90 at Maybank.',
    confidence: 0.42,
  },
  {
    startMs: 22_000,
    endMs: 31_000,
    speakerLabel: 'Credit Manager',
    text: 'For the pricing, we quote fixed interest rate of 8% per annum lah.',
    confidence: 0.91,
  },
  {
    startMs: 31_000,
    endMs: 40_000,
    speakerLabel: 'Shariah Officer',
    text: 'Wait — kalau Islamic facility, cannot pakai interest. Kena guna Murabahah profit rate.',
    confidence: 0.57,
  },
  {
    startMs: 40_000,
    endMs: 47_000,
    speakerLabel: 'Credit Officer',
    text: 'Noted. Same director, IC 880101-14-5678, card 4111 1111 1111 1111 for the fee.',
    confidence: 0.83,
  },
] as const;

/**
 * How many fixture segments fall below the review floor.
 *
 * Exported so a test asserts the fixture still exercises the low-confidence path
 * rather than silently drifting above the threshold and passing vacuously.
 */
export const LOW_CONFIDENCE_FIXTURE_COUNT = 2;

export class FakeTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'fake' as const;

  transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    // Still validates its input. A caller passing empty audio has a bug, and a
    // fake that accepted it would hide that bug until production.
    if (audio.bytes.byteLength === 0) {
      return Promise.reject(new TranscriptionError('fake', 'received empty audio'));
    }

    return Promise.resolve({
      segments: FIXTURE.map((segment) => ({ ...segment })),
      languages: ['en', 'ms'],
      modelId: FAKE_MODEL_ID,
      promptVersion: FAKE_PROMPT_VERSION,
    });
  }

  /**
   * Deterministic fixture. The NRIC is synthetic and deliberately present, and
   * appears in both fields: a redaction test whose input holds no identifier
   * passes vacuously, and one identifier written twice must still get one
   * placeholder.
   */
  extractWhiteboard(): Promise<WhiteboardExtraction> {
    return Promise.resolve({
      kind: 'WHITEBOARD',
      mermaid:
        'graph TD;\n'
        + '  A[Applicant 880101-14-5678] --> B[Murabahah 500k];\n'
        + '  B --> C[Tenure 60 months];',
      structured: {
        facility: 'Murabahah',
        principalMyr: 500_000,
        tenureMonths: 60,
        applicantNric: '880101-14-5678',
        // A number, not a string, and long enough for the account detector to
        // match. Redacting a numeric literal in serialised JSON produces
        // invalid JSON unless the value is quoted first, so this fixture is
        // what keeps that path honest.
        settlementAccount: 1_234_567_890,
      },
      modelId: 'fake-vision',
      promptVersion: 'fake-whiteboard-v2',
    });
  }

  /**
   * A deterministic topic list, including one placeholder label on purpose.
   *
   * `[NRIC_1]` is returned so a test can prove the pipeline filters it out rather
   * than storing it. A fake that only returned clean labels would let the
   * placeholder guard pass while never running — the same vacuity trap as a
   * redaction test whose input holds no identifier.
   */
  extractTopics(): Promise<readonly TopicDraft[]> {
    return Promise.resolve([
      { label: 'murabahah', kind: 'CONTRACT', weight: 0.9 },
      { label: 'working capital', kind: 'PRODUCT', weight: 0.8 },
      { label: 'interest rate', kind: 'ISSUE', weight: 0.75 },
      { label: 'sme lending', kind: 'PRODUCT', weight: 0.6 },
      // Must never reach the database. See indexForKnowledge.
      { label: '[NRIC_1]', kind: 'TERM', weight: 0.5 },
    ]);
  }

  /**
   * A deterministic pseudo-embedding derived from the text's own characters.
   *
   * Not a real embedding and not pretending to be: it exists so similarity code
   * has stable, non-degenerate vectors to work on in tests. Two identical texts
   * embed identically and two different ones differ, which is all the graph and
   * ranking logic need to be exercised.
   */
  embed(redactedText: string): Promise<readonly number[]> {
    const dimensions = 32;
    const vector = new Array<number>(dimensions).fill(0);
    for (let i = 0; i < redactedText.length; i += 1) {
      const code = redactedText.charCodeAt(i);
      const slot = code % dimensions;
      vector[slot] = (vector[slot] ?? 0) + 1;
    }
    // Normalised, so cosine similarity behaves the way it would on real vectors.
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return Promise.resolve(norm === 0 ? vector : vector.map((value) => value / norm));
  }

  /**
   * A deterministic decision list: one point resolved, one left open — so a
   * test can exercise both branches of "state the decision or mark it
   * unresolved" without an API key.
   */
  arbitrateDecisions(): Promise<readonly DecisionDraft[]> {
    return Promise.resolve([
      {
        topic: 'Facility amount and tenure',
        decision: 'Approved at RM 50,000 over a five-year tenure.',
        rationale: 'Matches the expansion the credit officer described; no objection was raised.',
      },
      {
        topic: 'Pricing basis',
        decision: 'Left unresolved.',
        rationale:
          'The Shariah officer objected to the quoted 8% interest rate and proposed a Murabahah '
          + 'profit rate instead; the meeting ended before the two sides agreed.',
      },
    ]);
  }

  /**
   * Owners are role labels, never names. The fixture text has no names to draw
   * from in the first place — only placeholders — which is the point.
   */
  extractActionItems(): Promise<readonly ActionItemDraft[]> {
    return Promise.resolve([
      {
        owner: 'Shariah Officer',
        task: 'Confirm a Murabahah profit rate to replace the quoted interest rate.',
      },
      {
        owner: 'Credit Manager',
        task: 'Re-submit the facility once pricing is agreed.',
        dueDate: 'next committee meeting',
      },
    ]);
  }

  /**
   * A fixed kickoff draft and two follow-ups, echoing the same placeholder
   * convention as `summarize`: clean text in, clean text out, nothing invented.
   */
  draftProject(): Promise<{ kickoff: string; followUps: readonly string[] }> {
    return Promise.resolve({
      kickoff:
        'Kick off the Tech Solutions SME working capital facility: confirm the pricing basis, '
        + 'then route to the checker for approval.',
      followUps: [
        'Confirm the Murabahah profit rate with the Shariah officer.',
        'Re-submit the term sheet once pricing is agreed.',
      ],
    });
  }

  /**
   * Answers only from what it was handed, like the real one.
   *
   * Cites every meeting supplied and reports unanswerable when given none, so the
   * assistant's citation-intersection and unanswerable paths are both reachable
   * without an API key.
   */
  answerFromContext(
    question: string,
    excerpts: readonly GroundingExcerpt[],
  ): Promise<GroundedAnswer> {
    if (excerpts.length === 0) {
      return Promise.resolve({
        answer: 'The supplied meetings do not answer that question.',
        citedMeetingIds: [],
        unanswerable: true,
        modelId: FAKE_MODEL_ID,
        promptVersion: FAKE_PROMPT_VERSION,
      });
    }

    return Promise.resolve({
      answer:
        `Based on ${String(excerpts.length)} meeting(s): the committee discussed an `
        + 'SME working capital facility, and the pricing basis was left unresolved '
        + 'between an interest rate and a Murabahah profit rate.',
      citedMeetingIds: excerpts.map((excerpt) => excerpt.meetingId),
      unanswerable: false,
      modelId: FAKE_MODEL_ID,
      promptVersion: FAKE_PROMPT_VERSION,
    });
  }

  summarize(redactedText: string): Promise<string> {
    // Echoes a placeholder back so a test can prove the pipeline re-redacts
    // whatever a summariser returns rather than trusting it.
    const mentionsNric = redactedText.includes('[NRIC_1]');
    return Promise.resolve(
      'Credit committee discussed a MYR 50,000 SME working capital facility over a '
      + 'five-year tenure. Pricing was quoted as an 8% per annum interest rate; the '
      + 'Shariah officer objected that an Islamic facility requires a Murabahah '
      + 'profit rate instead. Pricing basis is unresolved.'
      + (mentionsNric ? ' Director identified as [NRIC_1].' : ''),
    );
  }
}
