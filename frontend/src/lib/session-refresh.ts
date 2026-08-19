/**
 * Lets a descendant ask the signed-in shell to refetch `/auth/me`.
 *
 * The shell's own session state lives in app/(app)/layout.tsx, an ancestor
 * of every page — there is no prop path from a page back up to it. Same
 * shape as setSessionExpiredHandler in api-client.ts, which solves the
 * identical problem (a descendant needs to reach shell-level session
 * state) for the opposite event.
 *
 * Used when a page changes something on the session itself (today: the
 * avatar color picker in Settings) that the sidebar/profile menu also
 * render, so they do not go on showing a stale value for the rest of the
 * browser session.
 */

let onSessionChanged: (() => void) | null = null;

export function setSessionChangedHandler(handler: (() => void) | null): void {
  onSessionChanged = handler;
}

export function notifySessionChanged(): void {
  onSessionChanged?.();
}
