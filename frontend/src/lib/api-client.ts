export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`API error ${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

const API_PREFIX = '/api';

/**
 * Relative in the browser, absolute on the server. Both halves are load-bearing.
 *
 * The browser must use the relative prefix: `/api` is rewritten to the backend
 * by next.config.ts, and that is what keeps the session cookie first-party. Call
 * the backend's own origin instead and Safari discards the cookie as
 * third-party, so login silently fails.
 *
 * The server has no origin to resolve a relative URL against, and Node's fetch
 * rejects one outright — "Failed to parse URL from /api/health", which is how
 * this was found: the landing page checks the backend during SSR. Server-side
 * calls therefore go straight to the backend, which is also correct because they
 * carry no session cookie for the proxy to keep first-party.
 */
function baseUrl(): string {
  if (typeof window !== 'undefined') return API_PREFIX;

  const origin = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  if (!origin) {
    throw new Error(
      'NEXT_PUBLIC_API_BASE_URL is not set, and a server-side call cannot use a '
      + 'relative URL.',
    );
  }

  return origin;
}

/**
 * Paths where a 401 does not mean "the access token merely expired". Login
 * and register 401/409 on their own terms (wrong password, existing
 * account) and must surface that directly; refresh 401ing means the
 * refresh cookie itself is gone, so retrying it would only recurse.
 */
const SKIP_REFRESH_PATHS = new Set(['/auth/login', '/auth/register', '/auth/refresh']);

let onSessionExpired: (() => void) | null = null;

/**
 * Registered once by the signed-in app shell. A 401 that survives a
 * refresh attempt means the session is genuinely gone — not merely due
 * for a refresh — and every page that calls the API should end up back at
 * sign-in for that, not just the one place that happens to check `/me` on
 * mount. Centralizing it here means every apiFetch call site gets that
 * behavior for free rather than each needing its own copy.
 */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Shared across concurrent callers: several requests 401ing around the same
 * moment (a page firing a few parallel loads right as the token expires)
 * must trigger one refresh, not one each.
 */
function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= fetch(`${baseUrl()}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function toApiError(response: Response): Promise<ApiError> {
  let detail = response.statusText;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      /**
       * `detail` is what sendProblem emits, so it wins. Fastify's own
       * errors carry `message` instead, and falling through to a bare
       * "Bad Request" is what kept the empty-body bug above invisible on
       * screen for as long as it lasted.
       */
      if ('detail' in body) {
        detail = String((body as { detail: unknown }).detail);
      } else if ('message' in body) {
        detail = String((body as { message: unknown }).message);
      }
    }
  } catch {
    // Non-JSON error body: keep statusText. Nothing to recover here.
  }
  return new ApiError(response.status, detail);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  /**
   * FormData must not carry an explicit content-type. The browser generates a
   * multipart boundary and puts it in that header; setting it ourselves sends a
   * boundary-less content-type and the server cannot parse the body at all.
   */
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;

  /**
   * A JSON content-type is only honest when a JSON body follows it.
   *
   * Fastify refuses the combination outright — FST_ERR_CTP_EMPTY_JSON_BODY,
   * "Body cannot be empty when content-type is set to 'application/json'" —
   * and answers 400 before the route ever runs. Sending the header
   * unconditionally therefore broke every bodyless mutation at once:
   * logout, meeting archive, term-sheet submit, registration reject and
   * segment confirm. Most of them failed silently, because nothing on the
   * screen was waiting on the response.
   */
  const hasBody = init?.body !== undefined && init.body !== null;

  const url = `${baseUrl()}${path}`;
  const options: RequestInit = {
    ...init,
    credentials: 'include',
    headers: isFormData || !hasBody
      ? { ...init?.headers }
      : { 'content-type': 'application/json', ...init?.headers },
  };

  const response = await fetch(url, options);
  if (response.ok) return (await response.json()) as T;

  /**
   * The access token lives 15 minutes (JWT_ACCESS_TTL); the refresh cookie
   * lives 7 days (JWT_REFRESH_TTL). A 401 here is routine mid-session —
   * FormData bodies are safe to resend, since fetch reads them fresh from
   * the same object each call rather than consuming them — so one silent
   * refresh plus a single retry covers it without ever surfacing an error.
   * Only a 401 that survives that attempt means the session is actually
   * gone, which is what onSessionExpired is for.
   */
  if (response.status === 401 && !SKIP_REFRESH_PATHS.has(path)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const retry = await fetch(url, options);
      if (retry.ok) return (await retry.json()) as T;
      throw await toApiError(retry);
    }
    onSessionExpired?.();
  }

  throw await toApiError(response);
}
