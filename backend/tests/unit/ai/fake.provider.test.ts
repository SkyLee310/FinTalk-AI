import { describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../../src/ai/fake.provider.js';
import { detectPii } from '../../../src/pdpa/detectors.js';

const provider = new FakeTranscriptionProvider();
const audio = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav' };

describe('FakeTranscriptionProvider', () => {
  it('identifies itself as the fake provider', () => {
    expect(provider.name).toBe('fake');
  });

  it('returns a multi-speaker transcript with ordered, contiguous segments', async () => {
    const { segments } = await provider.transcribe(audio);
    expect(segments.length).toBeGreaterThan(3);
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i]!.startMs).toBe(segments[i - 1]!.endMs);
      expect(segments[i]!.endMs).toBeGreaterThan(segments[i]!.startMs);
    }
    expect(new Set(segments.map((s) => s.speakerLabel)).size).toBeGreaterThan(1);
  });

  it('reports the mixed languages the scenario is written in', async () => {
    expect((await provider.transcribe(audio)).languages).toEqual(['en', 'ms']);
  });

  it('records a model id and prompt version for the audit trail', async () => {
    const result = await provider.transcribe(audio);
    expect(result.modelId).toBeTruthy();
    expect(result.promptVersion).toBeTruthy();
  });

  it('rejects empty audio instead of pretending to transcribe it', async () => {
    await expect(
      provider.transcribe({ bytes: new Uint8Array(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(/empty audio/);
  });

  /**
   * The fixture must contain detectable personal data. A fake that returned
   * clean text would let every redaction assertion downstream pass while the
   * redactor did nothing at all.
   */
  it('emits text the detectors actually find identifiers in', async () => {
    const { segments } = await provider.transcribe(audio);
    const kinds = segments.flatMap((s) => detectPii(s.text)).map((d) => d.kind);
    expect(kinds).toContain('NRIC');
    expect(kinds).toContain('BANK_ACCOUNT');
    expect(kinds).toContain('CARD');
  });

  it('mentions one NRIC in two different segments, for cross-segment tests', async () => {
    const { segments } = await provider.transcribe(audio);
    const withNric = segments.filter((s) =>
      detectPii(s.text).some((d) => d.kind === 'NRIC'),
    );
    expect(withNric).toHaveLength(2);

    const values = withNric.flatMap((s) =>
      detectPii(s.text).filter((d) => d.kind === 'NRIC').map((d) => d.value),
    );
    expect(new Set(values).size).toBe(1);
  });
});
