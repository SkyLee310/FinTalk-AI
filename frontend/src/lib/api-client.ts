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

  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: isFormData || !hasBody
      ? { ...init?.headers }
      : { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
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
    throw new ApiError(response.status, detail);
  }

  return (await response.json()) as T;
}
