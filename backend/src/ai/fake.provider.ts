import {
  type AudioInput,
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
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

const FIXTURE = [
  {
    startMs: 0,
    endMs: 6_000,
    speakerLabel: 'Credit Officer',
    text: 'Okay boss, we nak discuss the SME working capital facility for Tech Solutions.',
  },
  {
    startMs: 6_000,
    endMs: 14_000,
    speakerLabel: 'Credit Manager',
    text: 'Amount berapa? I think RM 50,000 cukup for their expansion, tenure five years.',
  },
  {
    startMs: 14_000,
    endMs: 22_000,
    speakerLabel: 'Credit Officer',
    text: 'Betul. Director punya IC is 880101-14-5678, account 1234 5678 90 at Maybank.',
  },
  {
    startMs: 22_000,
    endMs: 31_000,
    speakerLabel: 'Credit Manager',
    text: 'For the pricing, we quote fixed interest rate of 8% per annum lah.',
  },
  {
    startMs: 31_000,
    endMs: 40_000,
    speakerLabel: 'Shariah Officer',
    text: 'Wait — kalau Islamic facility, cannot pakai interest. Kena guna Murabahah profit rate.',
  },
  {
    startMs: 40_000,
    endMs: 47_000,
    speakerLabel: 'Credit Officer',
    text: 'Noted. Same director, IC 880101-14-5678, card 4111 1111 1111 1111 for the fee.',
  },
] as const;

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
