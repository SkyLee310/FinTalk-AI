import { PrismaClient } from '@prisma/client';
import { createTranscriptionProvider } from '../ai/factory.js';
import { getEnv } from '../config/env.js';

/**
 * Gives already-captured meetings the embedding they never got.
 *
 * `process-meeting.ts` embeds a summary once, at capture time. A meeting
 * transcribed while no embedding model was configured therefore stores an
 * empty `summaryEmbedding` — and nothing ever revisits it. Configuring a model
 * later fixes the *next* meeting and leaves every earlier one permanently
 * outside similarity: `rankBySimilarity` scores an empty vector at zero and
 * drops it, and `buildGraph` reports `similarityUnavailable` because no stored
 * embedding exists to compare.
 *
 * So this is the one-off that closes that gap. It is idempotent — it selects
 * only transcripts whose embedding is empty, so a second run is a single query
 * and no API calls.
 *
 * It embeds `summaryEn`, the same already-redacted field the capture pipeline
 * embeds. The vault is not opened, and no text is written back: the only
 * column touched is the float array.
 *
 * Run: `npm run backfill:embeddings`, wherever DATABASE_URL is reachable.
 */

/** Per-transcript pause, so a large corpus does not trip provider rate limits. */
const PACE_MS = 200;

async function main(): Promise<void> {
  const env = getEnv();
  const prisma = new PrismaClient();
  const provider = createTranscriptionProvider(env);
  const embed = provider.embed?.bind(provider);

  try {
    if (embed === undefined) {
      console.error(
        'No embedding model is configured, so there is nothing to backfill with. '
        + 'Set GEMINI_MODEL_EMBEDDING and run this again.',
      );
      return;
    }

    const pending = await prisma.transcript.findMany({
      where: { summaryEmbedding: { isEmpty: true } },
      select: { id: true, meetingId: true, summaryEn: true },
    });

    if (pending.length === 0) {
      console.log('Every transcript already has an embedding. Nothing to do.');
      return;
    }

    console.log(`Embedding ${pending.length} transcript(s).`);

    let embedded = 0;
    let failed = 0;

    for (const transcript of pending) {
      try {
        const vector = await embed(transcript.summaryEn);

        /**
         * An empty vector is not written. Storing one would leave the row
         * looking backfilled while still scoring zero everywhere — the exact
         * silent state this script exists to end.
         */
        if (vector.length === 0) {
          console.error(`  ${transcript.meetingId}: model returned an empty vector, skipped.`);
          failed += 1;
          continue;
        }

        await prisma.transcript.update({
          where: { id: transcript.id },
          data: { summaryEmbedding: [...vector] },
        });
        embedded += 1;
      } catch (error) {
        // Named, then carried on: one transcript the model refuses should not
        // cost the rest of the corpus its backfill.
        failed += 1;
        console.error(
          `  ${transcript.meetingId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    }

    console.log(`Embedded ${embedded}, failed ${failed}.`);
    if (failed > 0) {
      console.error('Re-run to retry the failures — this script only touches empty embeddings.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Always exits 0.
 *
 * railway.json records why: a data-population step must never gate a deploy.
 * A corpus missing similarity still serves every page, and refusing to start
 * over it would trade a degraded feature for an outage. Failures are reported
 * above, loudly, where an operator reads them.
 */
main().catch((error: unknown) => {
  console.error('Backfill failed:', error);
});
