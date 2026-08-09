import { spawn } from 'node:child_process';
import {
  type AutomaticSpeechRecognitionOutput,
  type AutomaticSpeechRecognitionPipeline,
  pipeline,
} from '@huggingface/transformers';
import {
  type AudioInput,
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
} from './provider.js';

/**
 * On-host transcription: Whisper via ONNX Runtime, in this process.
 *
 * This is spec §11.3 Option A without the GPU host — audio is decoded and
 * transcribed locally and never leaves the machine, which removes the
 * cross-border transfer in RISK-001 entirely rather than mitigating it.
 *
 * What it costs, stated plainly because choosing this provider is a trade:
 *
 *  - No diarisation. Whisper returns text and timings, not who spoke, so every
 *    segment is labelled `Speaker`. Gemini attributed speakers by name.
 *  - No summary. `summarize` is deliberately not implemented, so the pipeline
 *    records that none was generated rather than inventing one locally.
 *  - Weaker on Bahasa Rojak. Whisper picks one language per 30-second window,
 *    so heavy code-switching mid-sentence comes out worse than Gemini managed.
 *  - The first call downloads the model (a few hundred MB) and caches it.
 */

/**
 * Whisper's fixed input rate. The model was trained on 16 kHz mono; feeding it
 * anything else silently changes the pitch it thinks it is hearing.
 */
const SAMPLE_RATE = 16_000;

const MODEL_ID = 'onnx-community/whisper-base';

/** Whisper's own window. Longer inputs are chunked with an overlap. */
const CHUNK_SECONDS = 30;
const STRIDE_SECONDS = 5;

/** One timestamped span of recognised speech, as the pipeline returns it. */
interface WhisperChunk {
  readonly text: string;
  readonly timestamp: readonly [number | null, number | null];
}

/**
 * Decodes any container ffmpeg understands into the mono float samples the model
 * expects, entirely through pipes.
 *
 * No temp file: spec §2 says raw audio is never written to disk, and a temp file
 * is storage — one that survives a crash and lands in a backup.
 */
function decodeToPcm(audio: AudioInput): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-f', 'f32le',
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      'pipe:1',
    ]);

    const output: Buffer[] = [];
    const errors: Buffer[] = [];

    ffmpeg.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    ffmpeg.stderr.on('data', (chunk: Buffer) => errors.push(chunk));

    ffmpeg.on('error', (cause: Error) => {
      reject(new TranscriptionError(
        'local',
        `ffmpeg could not be started (${cause.message}). It must be on PATH.`,
      ));
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        // ffmpeg's stderr describes the container, not its contents, so this
        // carries no speech. Trimmed anyway: it reaches a log, not the database.
        const detail = Buffer.concat(errors).toString('utf8').trim().slice(0, 200);
        reject(new TranscriptionError(
          'local',
          `ffmpeg exited ${String(code)} decoding ${audio.mimeType}: ${detail}`,
        ));
        return;
      }

      const bytes = Buffer.concat(output);
      if (bytes.byteLength === 0) {
        reject(new TranscriptionError('local', 'the recording decoded to no audio.'));
        return;
      }

      /**
       * Copied onto its own buffer rather than viewed in place. Node pools small
       * Buffers, so byteOffset is rarely 0 and a Float32Array over the pool
       * would read neighbouring allocations as samples.
       */
      const samples = new Float32Array(bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
      Buffer.from(samples.buffer).set(bytes);
      resolve(samples);
    });

    // ffmpeg can exit before the whole input is written, e.g. on a malformed
    // container. That surfaces as EPIPE here and as a non-zero code above.
    ffmpeg.stdin.on('error', () => undefined);
    ffmpeg.stdin.end(audio.bytes);
  });
}

export class LocalTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'local' as const;

  /**
   * Loaded once and shared. The weights are hundreds of megabytes; building a
   * pipeline per upload would re-read them every time.
   */
  private asr: Promise<AutomaticSpeechRecognitionPipeline> | undefined;

  private load(): Promise<AutomaticSpeechRecognitionPipeline> {
    this.asr ??= pipeline('automatic-speech-recognition', MODEL_ID, {
      // Quantised weights: roughly a quarter the memory, which is what makes
      // this viable on a CPU-only container at all.
      dtype: 'q8',
    });

    return this.asr;
  }

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    const samples = await decodeToPcm(audio);

    let result: AutomaticSpeechRecognitionOutput | AutomaticSpeechRecognitionOutput[];
    try {
      const asr = await this.load();
      result = await asr(samples, {
        chunk_length_s: CHUNK_SECONDS,
        stride_length_s: STRIDE_SECONDS,
        return_timestamps: true,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'unknown failure';
      throw new TranscriptionError('local', `Whisper inference failed: ${message}`);
    }

    const first = Array.isArray(result) ? result[0] : result;
    if (first === undefined) {
      throw new TranscriptionError('local', 'the model returned no output.');
    }

    /**
     * transformers.js types `chunks` loosely, so the shape is pinned here. Both
     * timestamps are optional: Whisper returns a null end when the audio stops
     * mid-window.
     */
    const chunks: WhisperChunk[] = first.chunks ?? [];

    const segments = chunks.flatMap((chunk: WhisperChunk) => {
      const text = chunk.text.trim();
      if (text === '') return [];

      // The final chunk's end timestamp can come back null when the audio ends
      // mid-window. Falling back to the start keeps startMs <= endMs, which the
      // database enforces.
      const [start, end] = chunk.timestamp;
      const startMs = Math.round((start ?? 0) * 1000);

      return [{
        startMs,
        endMs: Math.max(startMs, Math.round((end ?? start ?? 0) * 1000)),
        // Whisper does not diarise. Claiming a name here would be a fabrication
        // sitting in an audited record.
        speakerLabel: 'Speaker',
        text,
      }];
    });

    if (segments.length === 0) {
      throw new TranscriptionError('local', 'no speech was recognised in the recording.');
    }

    return {
      segments,
      // Whisper detects a language per window and transformers.js does not
      // surface it. Reporting a guess would be worse than reporting nothing.
      languages: [],
      modelId: MODEL_ID,
      promptVersion: 'local-whisper-v1',
    };
  }
}
