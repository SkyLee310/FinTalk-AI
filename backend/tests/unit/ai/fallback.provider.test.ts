import { describe, expect, it } from 'vitest';
import { FallbackTranscriptionProvider } from '../../../src/ai/fallback.provider.js';
import {
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
} from '../../../src/ai/provider.js';

const audio = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav' };

function result(modelId: string): TranscriptionResult {
  return {
    segments: [{ startMs: 0, endMs: 1000, speakerLabel: 'Speaker 1', text: modelId }],
    languages: ['en'],
    modelId,
    promptVersion: `${modelId}-v1`,
  };
}

describe('FallbackTranscriptionProvider', () => {
  it("reports the primary's name as its own", () => {
    const primary: TranscriptionProvider = {
      name: 'gemini',
      transcribe: () => Promise.resolve(result('gemini')),
    };
    const secondary: TranscriptionProvider = {
      name: 'openrouter',
      transcribe: () => Promise.resolve(result('openrouter')),
    };

    expect(new FallbackTranscriptionProvider(primary, secondary).name).toBe('gemini');
  });

  it('returns the primary result and never calls the secondary when the primary succeeds', async () => {
    let secondaryCalls = 0;
    const primary: TranscriptionProvider = {
      name: 'gemini',
      transcribe: () => Promise.resolve(result('gemini')),
    };
    const secondary: TranscriptionProvider = {
      name: 'openrouter',
      transcribe: () => {
        secondaryCalls += 1;
        return Promise.resolve(result('openrouter'));
      },
    };

    const output = await new FallbackTranscriptionProvider(primary, secondary).transcribe(audio);

    expect(output.modelId).toBe('gemini');
    expect(secondaryCalls).toBe(0);
  });

  it('retries against the secondary when the primary throws, and returns its result', async () => {
    const primary: TranscriptionProvider = {
      name: 'gemini',
      transcribe: () => Promise.reject(new TranscriptionError('gemini', 'boom')),
    };
    let secondaryCalls = 0;
    const secondary: TranscriptionProvider = {
      name: 'openrouter',
      transcribe: () => {
        secondaryCalls += 1;
        return Promise.resolve(result('openrouter'));
      },
    };

    const output = await new FallbackTranscriptionProvider(primary, secondary).transcribe(audio);

    expect(output.modelId).toBe('openrouter');
    expect(secondaryCalls).toBe(1);
  });

  it('propagates the failure when both the primary and the secondary fail', async () => {
    const primary: TranscriptionProvider = {
      name: 'gemini',
      transcribe: () => Promise.reject(new TranscriptionError('gemini', 'primary boom')),
    };
    const secondary: TranscriptionProvider = {
      name: 'openrouter',
      transcribe: () => Promise.reject(new TranscriptionError('openrouter', 'secondary boom')),
    };

    await expect(new FallbackTranscriptionProvider(primary, secondary).transcribe(audio))
      .rejects.toThrow(/secondary boom/);
  });

  it('exposes an optional method only when the primary implements it', () => {
    const secondary: TranscriptionProvider = {
      name: 'openrouter',
      transcribe: () => Promise.resolve(result('openrouter')),
      summarize: () => Promise.resolve('secondary summary'),
    };
    const primaryWithSummarize: TranscriptionProvider = {
      name: 'gemini',
      transcribe: () => Promise.resolve(result('gemini')),
      summarize: () => Promise.resolve('primary summary'),
    };
    const primaryWithoutSummarize: TranscriptionProvider = {
      name: 'gemini',
      transcribe: () => Promise.resolve(result('gemini')),
    };

    expect(new FallbackTranscriptionProvider(primaryWithSummarize, secondary).summarize)
      .toBeDefined();
    expect(new FallbackTranscriptionProvider(primaryWithoutSummarize, secondary).summarize)
      .toBeUndefined();
  });

  it('falls an optional method back to the secondary on primary failure', async () => {
    const primary: TranscriptionProvider = {
      name: 'gemini',
      transcribe: () => Promise.resolve(result('gemini')),
      summarize: () => Promise.reject(new TranscriptionError('gemini', 'summarize boom')),
    };
    let secondaryCalls = 0;
    const secondary: TranscriptionProvider = {
      name: 'openrouter',
      transcribe: () => Promise.resolve(result('openrouter')),
      summarize: (text) => {
        secondaryCalls += 1;
        return Promise.resolve(`fallback: ${text}`);
      },
    };

    const fallback = new FallbackTranscriptionProvider(primary, secondary);
    const summary = await fallback.summarize!('redacted text');

    expect(summary).toBe('fallback: redacted text');
    expect(secondaryCalls).toBe(1);
  });

  it('does not retry an optional method the secondary does not implement', async () => {
    const primary: TranscriptionProvider = {
      name: 'gemini',
      transcribe: () => Promise.resolve(result('gemini')),
      summarize: () => Promise.reject(new TranscriptionError('gemini', 'summarize boom')),
    };
    const secondaryWithoutSummarize: TranscriptionProvider = {
      name: 'openrouter',
      transcribe: () => Promise.resolve(result('openrouter')),
    };

    const fallback = new FallbackTranscriptionProvider(primary, secondaryWithoutSummarize);

    await expect(fallback.summarize!('redacted text')).rejects.toThrow(/summarize boom/);
  });

  /**
   * embed() has no fallback path even when the secondary implements it: two
   * different embedding models produce vectors that are not comparable, so
   * silently switching models would corrupt cross-meeting similarity instead
   * of degrading it honestly.
   */
  it('never falls back embed, even when the secondary implements it', async () => {
    const primary: TranscriptionProvider = {
      name: 'gemini',
      transcribe: () => Promise.resolve(result('gemini')),
      embed: () => Promise.reject(new TranscriptionError('gemini', 'embed boom')),
    };
    let secondaryEmbedCalls = 0;
    const secondary: TranscriptionProvider = {
      name: 'openrouter',
      transcribe: () => Promise.resolve(result('openrouter')),
      embed: () => {
        secondaryEmbedCalls += 1;
        return Promise.resolve([1, 2, 3]);
      },
    };

    const fallback = new FallbackTranscriptionProvider(primary, secondary);

    await expect(fallback.embed!('redacted text')).rejects.toThrow(/embed boom/);
    expect(secondaryEmbedCalls).toBe(0);
  });
});
