/**
 * Keyword retrieval — the fallback that keeps Ask FinTalk AI answerable.
 *
 * Semantic retrieval is the better instrument and stays the first choice. But
 * it needs two things this deployment cannot assume: an embedding model
 * configured now, and an embedding stored against a transcript *at the time it
 * was captured*. When either is missing the assistant used to refuse outright
 * — a whole feature disabled by one absent environment variable, and meetings
 * captured before embeddings existed left permanently unreachable even after
 * one was configured.
 *
 * So this exists to degrade rather than disappear. It is deliberately
 * unclever: term overlap, no stemming, no synonyms, no tf-idf. Anything
 * smarter would invite a reader to trust it as far as the embedding path, and
 * it should not be trusted that far — which is why `ask()` reports which of
 * the two actually retrieved an answer instead of presenting them alike.
 *
 * It scores `Transcript.rawRedacted`, the same already-redacted text the
 * embedding path reads. The vault is not opened here either.
 */

/**
 * Anything placeholder-shaped is stripped from the query, brackets or not.
 *
 * Same correctness argument as the graph's node guard: redaction contexts are
 * per-meeting, so `[NRIC_1]` in one transcript and `[NRIC_1]` in another are
 * different people. Matching on one would assert a relationship that does not
 * exist. `ask()` already refuses questions carrying real identifiers, so this
 * covers the remaining case — someone typing a placeholder they read on screen.
 */
const PLACEHOLDER_TOKEN = /^\[?[a-z_]+_\d+\]?$/;

/**
 * Words too common to carry a signal here.
 *
 * Two kinds: ordinary English function words, and terms that appear in
 * practically every credit-committee transcript ("meeting", "facility",
 * "discussed"). Both match everything, and a term that matches everything
 * ranks nothing.
 */
const STOPWORDS = new Set([
  'about', 'and', 'any', 'are', 'been', 'but', 'can', 'could', 'did', 'does',
  'for', 'from', 'had', 'has', 'have', 'how', 'into', 'its', 'more', 'much',
  'not', 'over', 'said', 'say', 'should', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'was', 'were', 'what',
  'when', 'where', 'which', 'who', 'why', 'with', 'would', 'you',
  'anything', 'discuss', 'discussed', 'facility', 'meeting', 'meetings',
  'something',
]);

/** Shortest token worth matching. Two letters carry no signal. */
const MIN_TERM_LENGTH = 3;

/**
 * The distinct, usable terms in a question.
 *
 * Exported for its test, and because "what counts as a term" is the whole of
 * this module's judgement — it deserves to be inspectable rather than buried.
 */
export function queryTerms(query: string): readonly string[] {
  const tokens = query
    .toLowerCase()
    // Split on anything that is not a word character, but keep brackets and
    // underscores attached so PLACEHOLDER_TOKEN can still recognise them.
    .split(/[^a-z0-9_[\]]+/)
    .filter((token) => token.length >= MIN_TERM_LENGTH)
    .filter((token) => !STOPWORDS.has(token))
    .filter((token) => !PLACEHOLDER_TOKEN.test(token));

  return [...new Set(tokens)];
}

/**
 * Ranks candidates by the share of query terms their text contains.
 *
 * Returns the same `{ meetingId, score }` shape as `rankBySimilarity` in
 * graph.ts, so `ask()` can substitute one for the other without reshaping
 * anything downstream. `score` is a 0–1 coverage fraction, **not** a cosine
 * similarity — the two are not comparable, which is precisely why an answer
 * carries the retrieval mode that produced it.
 *
 * A query with no usable terms returns nothing. Returning everything would
 * hand the model five arbitrary transcripts to answer from, which is the
 * grounding failure this product is built to refuse.
 */
export function rankByKeyword(
  query: string,
  candidates: readonly { readonly meetingId: string; readonly text: string }[],
  limit: number,
): readonly { readonly meetingId: string; readonly score: number }[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  return candidates
    .map((candidate) => {
      const haystack = candidate.text.toLowerCase();
      const hits = terms.filter((term) => haystack.includes(term)).length;
      return { meetingId: candidate.meetingId, score: hits / terms.length };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
