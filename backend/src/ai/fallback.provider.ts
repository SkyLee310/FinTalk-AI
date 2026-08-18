import type {
  ActionItemDraft,
  AudioInput,
  DecisionDraft,
  GroundedAnswer,
  GroundingExcerpt,
  ImageInput,
  ProjectDraft,
  ProviderName,
  TermSheetSuggestion,
  TopicDraft,
  TranscriptionProvider,
  TranscriptionResult,
  WhiteboardExtraction,
} from './provider.js';

/**
 * Wraps a primary provider with a secondary used only when the primary
 * throws. `transcribe` (required by the interface) always has both. Every
 * optional method is present on the wrapper only when the *primary*
 * implements it — matching "a provider without a capability omits it" — and
 * retries against the secondary only when the secondary implements it too;
 * otherwise the primary's own failure propagates unchanged.
 *
 * embed() is the one exception: it delegates to the primary only, with no
 * secondary attempt, even when the secondary implements it. Embeddings from
 * two different models are not comparable vectors, so falling back would
 * silently corrupt cross-meeting similarity rather than degrade it honestly.
 */
export class FallbackTranscriptionProvider implements TranscriptionProvider {
  readonly name: ProviderName;

  readonly summarize?: (redactedText: string) => Promise<string>;
  readonly extractWhiteboard?: (image: ImageInput) => Promise<WhiteboardExtraction>;
  readonly extractTopics?: (redactedSummary: string) => Promise<readonly TopicDraft[]>;
  readonly embed?: (redactedText: string) => Promise<readonly number[]>;
  readonly arbitrateDecisions?: (redactedText: string) => Promise<readonly DecisionDraft[]>;
  readonly extractActionItems?: (redactedText: string) => Promise<readonly ActionItemDraft[]>;
  readonly draftProject?: (redactedText: string) => Promise<ProjectDraft>;
  readonly answerFromContext?: (
    question: string,
    excerpts: readonly GroundingExcerpt[],
  ) => Promise<GroundedAnswer>;
  readonly suggestTermSheet?: (redactedContext: string) => Promise<TermSheetSuggestion>;

  private readonly primary: TranscriptionProvider;
  private readonly secondary: TranscriptionProvider;

  constructor(primary: TranscriptionProvider, secondary: TranscriptionProvider) {
    this.primary = primary;
    this.secondary = secondary;
    this.name = primary.name;

    if (primary.summarize) {
      const runPrimary = primary.summarize.bind(primary);
      const runSecondary = secondary.summarize?.bind(secondary);
      this.summarize = (text) => withFallback(
        primary.name, secondary.name, 'summarize', () => runPrimary(text), runSecondary && (() => runSecondary(text)),
      );
    }

    if (primary.extractWhiteboard) {
      const runPrimary = primary.extractWhiteboard.bind(primary);
      const runSecondary = secondary.extractWhiteboard?.bind(secondary);
      this.extractWhiteboard = (image) => withFallback(
        primary.name, secondary.name, 'extractWhiteboard', () => runPrimary(image), runSecondary && (() => runSecondary(image)),
      );
    }

    if (primary.extractTopics) {
      const runPrimary = primary.extractTopics.bind(primary);
      const runSecondary = secondary.extractTopics?.bind(secondary);
      this.extractTopics = (summary) => withFallback(
        primary.name, secondary.name, 'extractTopics', () => runPrimary(summary), runSecondary && (() => runSecondary(summary)),
      );
    }

    if (primary.arbitrateDecisions) {
      const runPrimary = primary.arbitrateDecisions.bind(primary);
      const runSecondary = secondary.arbitrateDecisions?.bind(secondary);
      this.arbitrateDecisions = (text) => withFallback(
        primary.name, secondary.name, 'arbitrateDecisions', () => runPrimary(text), runSecondary && (() => runSecondary(text)),
      );
    }

    if (primary.extractActionItems) {
      const runPrimary = primary.extractActionItems.bind(primary);
      const runSecondary = secondary.extractActionItems?.bind(secondary);
      this.extractActionItems = (text) => withFallback(
        primary.name, secondary.name, 'extractActionItems', () => runPrimary(text), runSecondary && (() => runSecondary(text)),
      );
    }

    if (primary.draftProject) {
      const runPrimary = primary.draftProject.bind(primary);
      const runSecondary = secondary.draftProject?.bind(secondary);
      this.draftProject = (text) => withFallback(
        primary.name, secondary.name, 'draftProject', () => runPrimary(text), runSecondary && (() => runSecondary(text)),
      );
    }

    if (primary.answerFromContext) {
      const runPrimary = primary.answerFromContext.bind(primary);
      const runSecondary = secondary.answerFromContext?.bind(secondary);
      this.answerFromContext = (question, excerpts) => withFallback(
        primary.name,
        secondary.name,
        'answerFromContext',
        () => runPrimary(question, excerpts),
        runSecondary && (() => runSecondary(question, excerpts)),
      );
    }

    if (primary.suggestTermSheet) {
      const runPrimary = primary.suggestTermSheet.bind(primary);
      const runSecondary = secondary.suggestTermSheet?.bind(secondary);
      this.suggestTermSheet = (context) => withFallback(
        primary.name, secondary.name, 'suggestTermSheet', () => runPrimary(context), runSecondary && (() => runSecondary(context)),
      );
    }

    // No secondary attempt — see the class doc comment.
    if (primary.embed) {
      const runPrimary = primary.embed.bind(primary);
      this.embed = (text) => runPrimary(text);
    }
  }

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    return withFallback(
      this.primary.name,
      this.secondary.name,
      'transcribe',
      () => this.primary.transcribe(audio),
      () => this.secondary.transcribe(audio),
    );
  }
}

/**
 * Only `cause.name` ever reaches this log line, on the same reasoning as
 * gemini.provider.ts's logApiErrorStatus: whatever failed upstream may be
 * quoting the payload it was sent, and that payload can be meeting audio or
 * transcript text.
 */
async function withFallback<T>(
  primaryName: ProviderName,
  secondaryName: ProviderName,
  stage: string,
  runPrimary: () => Promise<T>,
  runSecondary: (() => Promise<T>) | undefined,
): Promise<T> {
  try {
    return await runPrimary();
  } catch (cause) {
    if (!runSecondary) throw cause;
    console.error(
      `[fallback:${stage}] ${primaryName} failed${cause instanceof Error ? ` (${cause.name})` : ''}, `
      + `retrying against ${secondaryName}`,
    );
    return await runSecondary();
  }
}
