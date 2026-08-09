/**
 * Runs the on-host Whisper provider against a real recording.
 *
 * Exercises the local path without the database or the HTTP layer, so a failure
 * here is the model or ffmpeg rather than the pipeline around them. The first
 * run downloads the weights and caches them under node_modules/.cache.
 *
 * Usage: npx tsx scripts/try-local-transcribe.ts "<path to audio>"
 */
import { readFile } from 'node:fs/promises';
import { LocalTranscriptionProvider } from '../src/ai/local.provider.js';

const path = process.argv[2];

if (path === undefined) {
  process.stderr.write('usage: tsx scripts/try-local-transcribe.ts <audio file>\n');
  process.exit(1);
}

const bytes = await readFile(path);
process.stdout.write(`read ${String(bytes.byteLength)} bytes\n`);

const started = Date.now();
const result = await new LocalTranscriptionProvider().transcribe({
  bytes,
  mimeType: 'audio/mpeg',
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

process.stdout.write(
  `\nmodel: ${result.modelId} | prompt: ${result.promptVersion}\n`
  + `segments: ${String(result.segments.length)} in ${elapsed}s\n`
  + `languages reported: ${result.languages.length === 0 ? '(none)' : result.languages.join(', ')}\n\n`,
);

for (const segment of result.segments.slice(0, 14)) {
  const at = (segment.startMs / 1000).toFixed(1);
  process.stdout.write(`[${at}s ${segment.speakerLabel}] ${segment.text}\n`);
}
