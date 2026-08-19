'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Live captions via the browser's own Web Speech API — a separate, much
 * faster path than the meeting's real transcript, which is still produced
 * by Vertex/Gemini only after the recording is uploaded. This hook never
 * touches that pipeline; it only gives a rough, on-screen glance while the
 * microphone is live.
 *
 * SpeechRecognition is not part of TypeScript's DOM lib — it remains
 * non-standard and vendor-prefixed — so this file carries its own narrow
 * ambient types for only what it calls.
 */

declare global {
  interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    [index: number]: SpeechRecognitionAlternative;
  }

  interface SpeechRecognitionResultList {
    readonly length: number;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }

  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

/** One finalized, already-redacted caption line. */
export interface LiveCaptionLine {
  readonly id: number;
  readonly textRedacted: string;
  /** When this line was finalized, for display next to it in the history list. */
  readonly timestampMs: number;
}

export interface UseLiveCaptionsOptions {
  readonly enabled: boolean;
  /** A BCP-47 tag, e.g. "en-US" — the single language recognition listens for. */
  readonly language: string;
}

export interface LiveCaptions {
  readonly lines: readonly LiveCaptionLine[];
  /**
   * The most recent not-yet-final line, shown raw and unredacted — it can
   * change multiple times a second while still being recognized, so
   * redacting it on every tick would spend a round trip on text about to be
   * overwritten. Only finalized lines ever reach the server.
   */
  readonly interimText: string;
  /** False when this browser has no speech recognition at all. */
  readonly supported: boolean;
  readonly error: string | null;
  /**
   * Clears accumulated lines. The hook itself never does this on its own —
   * pausing and resuming a recording toggles `enabled` off and on without
   * losing history, so only the caller knows when a truly new recording
   * (not a resume) has started and the slate should actually be wiped.
   */
  readonly reset: () => void;
}

/** Permission/hardware failures a restart cannot recover from. */
const TERMINAL_ERRORS = new Set(['not-allowed', 'audio-capture', 'service-not-allowed']);

export function useLiveCaptions({ enabled, language }: UseLiveCaptionsOptions): LiveCaptions {
  const [lines, setLines] = useState<LiveCaptionLine[]>([]);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Probed in an effect, not at module scope, so server and first-paint
  // client render agree — see use-recorder.ts's identical `supported` guard.
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(
      typeof window !== 'undefined'
      && (window.SpeechRecognition !== undefined || window.webkitSpeechRecognition !== undefined),
    );
  }, []);

  const nextIdRef = useRef(0);

  const reset = useCallback(() => {
    setLines([]);
    setInterimText('');
    setError(null);
    nextIdRef.current = 0;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const Constructor = typeof window === 'undefined'
      ? undefined
      : window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (Constructor === undefined) return undefined;

    setError(null);

    let cancelled = false;
    let stoppedForGood = false;
    let current: SpeechRecognition | null = null;

    // Takes the constructor as a parameter, rather than relying on
    // TypeScript to carry the outer `undefined` check's narrowing into this
    // nested function — it does not, since the check and this closure are in
    // different scopes.
    function startOnce(ctor: new () => SpeechRecognition): void {
      const recognition = new ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;

      recognition.onresult = (event) => {
        let latestInterim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]!;
          const transcript = (result[0]?.transcript ?? '').trim();
          if (!result.isFinal) {
            latestInterim = transcript;
            continue;
          }
          if (transcript === '') continue;

          const id = nextIdRef.current;
          nextIdRef.current += 1;
          const timestampMs = Date.now();
          void api.redactLiveCaption(transcript).then(
            ({ textRedacted }) => {
              if (cancelled) return;
              setLines((prev) => [...prev, { id, textRedacted, timestampMs }]);
            },
            () => {
              if (cancelled) return;
              setError('A caption line could not be masked and was skipped.');
            },
          );
        }
        if (!cancelled) setInterimText(latestInterim);
      };

      recognition.onerror = (event) => {
        if (cancelled) return;
        if (TERMINAL_ERRORS.has(event.error)) {
          stoppedForGood = true;
          setError(
            event.error === 'audio-capture'
              ? 'No microphone was found for live captions.'
              : 'Live captions access was blocked for this browser.',
          );
        }
      };

      // continuous mode still ends on its own after a period of silence in
      // some browsers, so ending is treated as routine and restarted —
      // unless this hook stopped it on purpose, or a permission/hardware
      // error means restarting would only fail the same way again.
      recognition.onend = () => {
        if (cancelled || stoppedForGood) return;
        setInterimText('');
        startOnce(ctor);
      };

      current = recognition;
      recognition.start();
    }

    startOnce(Constructor);

    return () => {
      cancelled = true;
      current?.stop();
      current = null;
    };
  }, [enabled, language]);

  return { lines, interimText, supported, error, reset };
}
