'use client';

import { useEffect, useRef, useState } from 'react';
import { describeError } from '@/hooks/use-async';
import { api } from '@/lib/api';

/**
 * A rough, rolling transcript preview while recording.
 *
 * Runs a second, independent MediaRecorder on the same stream the main
 * recording already holds — never touching it, the same way the existing
 * mic-level meter's AnalyserNode taps the stream without disturbing the
 * recorder used for the real capture. Every `options.intervalMs`: record for
 * the interval, stop (producing one small, self-contained clip with its own
 * clean container header), send it to /meetings/live-preview for a quick
 * transcription, and show whatever comes back.
 *
 * Each response *replaces* the previous one; it is never appended into a
 * growing transcript. Every clip is transcribed independently of the others,
 * so there is no guarantee "Speaker 1" in one response is the same person as
 * "Speaker 1" in the last — only the most recent window is shown.
 */

export interface LivePreviewSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly speakerLabel: string;
  readonly textRedacted: string;
  readonly confidence?: number;
}

export interface UseLivePreviewOptions {
  /** Off whenever the caller doesn't want live calls in flight — e.g. paused, or not recording. */
  readonly enabled: boolean;
  readonly mimeType: string | undefined;
  readonly consentConfirmed: boolean;
  readonly transferAcknowledged: boolean;
  readonly intervalMs: number;
}

export interface LivePreview {
  readonly segments: readonly LivePreviewSegment[];
  readonly error: string | null;
}

export function useLivePreview(
  stream: MediaStream | null,
  options: UseLivePreviewOptions,
): LivePreview {
  const { enabled, mimeType, consentConfirmed, transferAcknowledged, intervalMs } = options;
  const [segments, setSegments] = useState<readonly LivePreviewSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * Read fresh inside each cycle without making the acknowledgement flags
   * part of the effect's dependency list — only a start/stop condition
   * (enabled, stream, mimeType) should tear down and restart the whole
   * cycling recorder; a checkbox flipping mid-cycle should just change what
   * the next already-scheduled call sends.
   */
  const ackRef = useRef({ consentConfirmed, transferAcknowledged });
  ackRef.current = { consentConfirmed, transferAcknowledged };

  useEffect(() => {
    if (!enabled || stream === null || mimeType === undefined) {
      setSegments([]);
      setError(null);
      return undefined;
    }

    const activeStream = stream;
    const activeMimeType = mimeType;
    let cancelled = false;
    let cycleRecorder: MediaRecorder | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function sendClip(clip: Blob): Promise<void> {
      if (clip.size === 0) return;
      const { consentConfirmed: consent, transferAcknowledged: transfer } = ackRef.current;
      if (!consent || !transfer) return;

      const form = new FormData();
      form.set('audio', clip, 'live-preview.webm');
      form.set('consentConfirmed', String(consent));
      form.set('transferAcknowledged', String(transfer));

      try {
        const result = await api.livePreview(form);
        if (!cancelled) {
          setSegments(result.segments);
          setError(null);
        }
      } catch (cause) {
        // Keep whatever the last successful cycle showed — one dropped call
        // should not blank out an otherwise-working preview. The next
        // scheduled cycle tries again on its own.
        if (!cancelled) setError(describeError(cause));
      }
    }

    function runCycle(): void {
      if (cancelled) return;

      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(activeStream, { mimeType: activeMimeType });
      cycleRecorder = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        if (cancelled) return;
        const clip = new Blob(chunks, { type: activeMimeType });
        void sendClip(clip).finally(() => {
          if (!cancelled) timer = setTimeout(runCycle, 0);
        });
      };

      recorder.start();
      timer = setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, intervalMs);
    }

    runCycle();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      if (cycleRecorder !== null && (cycleRecorder as MediaRecorder).state !== 'inactive') {
        (cycleRecorder as MediaRecorder).onstop = null;
        (cycleRecorder as MediaRecorder).stop();
      }
    };
  }, [enabled, stream, mimeType, intervalMs]);

  return { segments, error };
}
