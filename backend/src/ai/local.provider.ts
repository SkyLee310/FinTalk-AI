import {
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
} from './provider.js';

/**
 * Placeholder for the on-premise path in spec §11.3 Option A: a Malaysian
 * fine-tuned Whisper on the institution's own GPU host, so audio never crosses
 * a border.
 *
 * It throws rather than falling back to Gemini. A deployment that selected
 * `local` did so because sending audio to a third party was unacceptable;
 * quietly doing it anyway would be the worst available outcome, because the
 * operator would believe audio stayed on-premise while it did not.
 */
export class LocalTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'local' as const;

  // The audio parameter is omitted rather than ignored: this implementation
  // never looks at it, and a signature with fewer parameters still satisfies
  // TranscriptionProvider.
  transcribe(): Promise<TranscriptionResult> {
    return Promise.reject(
      new TranscriptionError(
        'local',
        'the on-premise transcriber is not installed. Set TRANSCRIPTION_PROVIDER '
        + 'to gemini or fake, or deploy a local model host — see spec section 11.3.',
      ),
    );
  }
}
