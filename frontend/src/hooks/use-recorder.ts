'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Microphone capture via MediaRecorder.
 *
 * Container support differs by browser and no single format works everywhere:
 * Chrome and Firefox write WebM/Opus, Safari writes MP4/AAC. Rather than
 * transcode, this sends whatever the browser produced and lets the upload route
 * pass the MIME type through to the provider, which accepts both. Declaring a
 * container the browser did not write would corrupt the audio.
 *
 * **This is not a durable recorder, and the UI must say so.** Audio accumulates
 * in one in-memory array until the user stops. A crashed tab, a closed laptop or
 * a navigation loses the take. Chunked upload during recording is the real
 * answer and is not built; implying a safety we do not provide would be worse
 * than the limitation.
 *
 * getUserMedia needs a secure context — HTTPS in production, and localhost
 * counts in development.
 */

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopped';

/** Ordered by preference. The first the browser admits to supporting wins. */
const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export interface Recorder {
  readonly state: RecorderState;
  /** Milliseconds captured, excluding paused time. */
  readonly elapsedMs: number;
  /** 0–1, for a level meter. Zero unless recording. */
  readonly level: number;
  readonly blob: Blob | null;
  readonly error: string | null;
  /** False when this browser cannot record at all, so the UI offers upload. */
  readonly supported: boolean;
  /**
   * The live microphone stream, so a second, independent consumer (e.g. a
   * rolling live-transcription preview) can tap it the same way the level
   * meter's AnalyserNode already does internally — without touching the
   * MediaRecorder this hook uses for the actual recording. Null whenever
   * nothing is recording.
   */
  readonly stream: MediaStream | null;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
}

export function useRecorder(): Recorder {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Probed in an effect, not at module scope: MediaRecorder does not exist
  // during server rendering, and touching it there breaks the build.
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(pickMimeType() !== undefined);
  }, []);

  /**
   * Releases the microphone. Without this the browser's recording indicator
   * stays lit after the user has finished, which is alarming and correct to
   * avoid.
   */
  const teardown = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;

    if (tickRef.current !== null) clearInterval(tickRef.current);
    tickRef.current = null;

    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    setStream(null);

    void audioCtxRef.current?.close();
    audioCtxRef.current = null;

    setLevel(0);
  }, []);

  // Covers navigating away mid-recording, which would otherwise hold the
  // microphone open for the life of the tab.
  useEffect(() => teardown, [teardown]);

  const start = useCallback(async (): Promise<void> => {
    setError(null);
    setBlob(null);
    setElapsedMs(0);
    chunksRef.current = [];

    const mimeType = pickMimeType();
    if (mimeType === undefined) {
      setError('This browser cannot record audio. Upload a recording instead.');
      return;
    }

    setState('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          // Left on deliberately: a credit meeting puts several people at
          // different distances from one microphone, and levelling them helps
          // the transcriber more than the artefacts hurt it.
          autoGainControl: true,
        },
      });
    } catch (cause) {
      setState('idle');
      // Refusal and absence need different advice: one is fixed in browser
      // settings, the other needs different hardware.
      const name = cause instanceof DOMException ? cause.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser settings, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found. Connect one, or upload a recording instead.'
            : 'The microphone could not be opened.',
      );
      return;
    }

    streamRef.current = stream;
    setStream(stream);

    // A level meter, so a dead microphone is visible before the meeting ends
    // rather than after. Reads the analyser and stores nothing.
    try {
      const context = new AudioContext();
      audioCtxRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);

      const samples = new Uint8Array(analyser.frequencyBinCount);
      const sample = (): void => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const value of samples) {
          peak = Math.max(peak, Math.abs(value - 128) / 128);
        }
        setLevel(peak);
        frameRef.current = requestAnimationFrame(sample);
      };
      frameRef.current = requestAnimationFrame(sample);
    } catch {
      // A missing meter is cosmetic. Losing the recording over it would not be.
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      setBlob(new Blob(chunksRef.current, { type: mimeType }));
      setState('stopped');
      teardown();
    };

    // A one-second timeslice so data arrives steadily rather than in one lump at
    // the end. It does not make the recording durable: the chunks are still only
    // in memory.
    recorder.start(1_000);
    setState('recording');

    tickRef.current = setInterval(() => {
      setElapsedMs((previous) => previous + 200);
    }, 200);
  }, [teardown]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state !== 'recording') return;
    recorderRef.current.pause();
    if (tickRef.current !== null) clearInterval(tickRef.current);
    tickRef.current = null;
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state !== 'paused') return;
    recorderRef.current.resume();
    tickRef.current = setInterval(() => {
      setElapsedMs((previous) => previous + 200);
    }, 200);
    setState('recording');
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current === null) return;
    if (recorderRef.current.state === 'inactive') return;
    // onstop assembles the blob and tears the stream down.
    recorderRef.current.stop();
  }, []);

  const reset = useCallback(() => {
    teardown();
    recorderRef.current = null;
    chunksRef.current = [];
    setBlob(null);
    setElapsedMs(0);
    setError(null);
    setState('idle');
  }, [teardown]);

  return {
    state,
    elapsedMs,
    level,
    blob,
    error,
    supported,
    stream,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}

/** Formats elapsed milliseconds as m:ss, or h:mm:ss past an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${String(hours)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A filename matched to what the browser actually produced. */
export function recordingFilename(blob: Blob): string {
  const extension = blob.type.includes('mp4')
    ? 'mp4'
    : blob.type.includes('ogg')
      ? 'ogg'
      : 'webm';
  return `meeting-recording.${extension}`;
}
