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

/**
 * Same-origin by design. `/api` is rewritten to the backend by next.config.ts,
 * which is what keeps the session cookie first-party — see the note there.
 * Calling the backend's own origin from the browser would make the cookie
 * third-party, and Safari would throw it away.
 */
const API_PREFIX = '/api';

function baseUrl(): string {
  return API_PREFIX;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  /**
   * FormData must not carry an explicit content-type. The browser generates a
   * multipart boundary and puts it in that header; setting it ourselves sends a
   * boundary-less content-type and the server cannot parse the body at all.
   */
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;

  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: isFormData
      ? { ...init?.headers }
      : { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'detail' in body) {
        detail = String((body as { detail: unknown }).detail);
      }
    } catch {
      // Non-JSON error body: keep statusText. Nothing to recover here.
    }
    throw new ApiError(response.status, detail);
  }

  return (await response.json()) as T;
}
