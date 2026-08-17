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

describe('FakeTranscriptionProvider.extractWhiteboard', () => {
  const provider = new FakeTranscriptionProvider();

  /**
   * Called with no argument on purpose. The fake never looks at the image, and
   * a method with fewer parameters still satisfies the interface — the same
   * choice local.provider.ts documents for transcribe().
   */

  it('returns a diagram and structured fields with provenance', async () => {
    const result = await provider.extractWhiteboard();

    expect(result.kind).toBe('WHITEBOARD');
    expect(result.mermaid).toContain('graph TD');
    expect(result.modelId).toBe('fake-vision');
    expect(result.promptVersion).toBe('fake-whiteboard-v2');
    expect(Object.keys(result.structured).length).toBeGreaterThan(0);
  });

  /**
   * The real detectors must find something in the fixture. Asserting against a
   * regex written here would only prove the fixture matches this test's own
   * idea of an identifier; asserting against detectPii proves the downstream
   * redaction tests have something to redact.
   */
  it('carries an identifier the detectors actually find', async () => {
    const result = await provider.extractWhiteboard();

    const found = detectPii(`${result.mermaid}\n${JSON.stringify(result.structured)}`);
    expect(found.filter((d) => d.kind === 'NRIC').length).toBeGreaterThan(0);
  });

  /**
   * The same NRIC is written in the diagram and in the structured fields, so a
   * shared redaction context has to collapse them to one placeholder. If the
   * fixture ever drifts to two different numbers, the route test asserting
   * "[NRIC_2] is absent" would pass for the wrong reason.
   */
  it('writes one identifier into both fields, not two different ones', async () => {
    const result = await provider.extractWhiteboard();

    const values = detectPii(`${result.mermaid}\n${JSON.stringify(result.structured)}`)
      .filter((d) => d.kind === 'NRIC')
      .map((d) => d.value);

    expect(values.length).toBe(2);
    expect(new Set(values).size).toBe(1);
  });

  it('is deterministic', async () => {
    const first = await provider.extractWhiteboard();
    const second = await provider.extractWhiteboard();

    expect(second.mermaid).toBe(first.mermaid);
    expect(second.structured).toEqual(first.structured);
  });
});
