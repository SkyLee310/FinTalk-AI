/**
 * Measures a captured audio blob's real playback length client-side, so the
 * upload can carry ground truth for correcting the transcription provider's
 * self-reported segment timestamps (see backend/src/ai/timestamps.ts).
 *
 * A MediaRecorder-produced WebM blob has no duration in its container header
 * until something forces the browser to compute one — an `<audio>` element
 * reports `Infinity` for `.duration` otherwise. Seeking past the end is the
 * documented workaround: it forces a scan of the file and fires
 * `durationchange` with the real value.
 *
 * Resolves `undefined` — never rejects — on any failure or after a 5s
 * timeout: a missing duration just means the server skips the timestamp
 * correction, not a failed upload.
 */
export function measureDurationMs(blob: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    let settled = false;

    function finish(durationMs: number | undefined): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(durationMs);
    }

    const timeout = window.setTimeout(() => finish(undefined), 5000);

    function settleFromDuration(duration: number): void {
      finish(Number.isFinite(duration) && duration > 0 ? duration * 1000 : undefined);
    }

    audio.preload = 'metadata';
    audio.addEventListener('error', () => finish(undefined));
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) {
        settleFromDuration(audio.duration);
        return;
      }
      audio.addEventListener('durationchange', () => settleFromDuration(audio.duration), {
        once: true,
      });
      audio.currentTime = Number.MAX_SAFE_INTEGER;
    });
    audio.src = url;
  });
}
