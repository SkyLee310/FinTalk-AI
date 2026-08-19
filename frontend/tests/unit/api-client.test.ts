import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, setSessionExpiredHandler } from '../../src/lib/api-client';

const BASE = 'http://localhost:8080';
process.env.NEXT_PUBLIC_API_BASE_URL = BASE;

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionExpiredHandler(null);
});

function stubFetch(response: Response) {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Each call returns the next response in order, for retry/refresh flows. */
function stubFetchSequence(...responses: Response[]) {
  const spy = vi.fn();
  for (const response of responses) spy.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

describe('apiFetch', () => {
  it('prefixes the base URL and sends credentials', async () => {
    const spy = stubFetch(new Response(JSON.stringify({ status: 'ok' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await apiFetch('/health');
    expect(spy).toHaveBeenCalledWith(
      `${BASE}/health`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns the parsed body', async () => {
    stubFetch(new Response(JSON.stringify({ status: 'ok', provider: 'fake' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await expect(apiFetch<{ status: string; provider: string }>('/health'))
      .resolves.toEqual({ status: 'ok', provider: 'fake' });
  });

  it('throws ApiError carrying status and problem detail', async () => {
    stubFetch(new Response(JSON.stringify({ detail: 'unresolved Shariah flag' }), {
      status: 409, headers: { 'content-type': 'application/problem+json' },
    }));
    await expect(apiFetch('/approvals')).rejects.toMatchObject({
      name: 'ApiError', status: 409, detail: 'unresolved Shariah flag',
    });
  });

  it('throws ApiError when the body is not JSON', async () => {
    stubFetch(new Response('gateway timeout', { status: 504 }));
    const err = await apiFetch('/health').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(504);
  });

  /**
   * Fastify rejects a JSON content-type with an empty body outright
   * (FST_ERR_CTP_EMPTY_JSON_BODY, 400). Sending the header on a bodyless
   * request broke five mutations in production at once — logout, archive,
   * submit, reject and confirm — so the absence of the header here is the
   * behaviour under test, not an incidental detail.
   */
  it('sends no content-type on a bodyless request', async () => {
    const spy = stubFetch(new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await apiFetch('/meetings/abc/archive', { method: 'PATCH' });
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).not.toHaveProperty('content-type');
  });

  it('still sends content-type when there is a JSON body', async () => {
    const spy = stubFetch(new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'a@b.c' }) });
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  /**
   * `detail` is sendProblem's shape; Fastify's own errors carry `message`.
   * Without this fallback a framework-level failure surfaced as a bare
   * "Bad Request", which is what kept the bug above invisible.
   */
  it('falls back to message when the error body has no detail', async () => {
    stubFetch(new Response(
      JSON.stringify({ statusCode: 400, error: 'Bad Request', message: 'Body cannot be empty' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    await expect(apiFetch('/auth/logout', { method: 'POST' })).rejects.toMatchObject({
      status: 400, detail: 'Body cannot be empty',
    });
  });

  /**
   * The access token expiring mid-session (JWT_ACCESS_TTL is 15 minutes) is
   * routine, not a sign the user was logged out — these lock in that a 401
   * triggers one silent refresh-and-retry before anything is shown as an
   * error, and that only a 401 surviving that attempt reaches the caller.
   */
  describe('session refresh on 401', () => {
    it('silently refreshes and retries once, returning the retried result', async () => {
      const spy = stubFetchSequence(
        jsonResponse(401, { detail: 'token expired' }),
        new Response(null, { status: 200 }),
        jsonResponse(200, { id: 'm1' }),
      );
      await expect(apiFetch('/meetings')).resolves.toEqual({ id: 'm1' });
      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy.mock.calls[1]?.[0]).toBe(`${BASE}/auth/refresh`);
      expect(spy.mock.calls[2]?.[0]).toBe(`${BASE}/meetings`);
    });

    it('calls the registered session-expired handler when refresh also fails', async () => {
      const handler = vi.fn();
      setSessionExpiredHandler(handler);
      stubFetchSequence(
        jsonResponse(401, { detail: 'token expired' }),
        jsonResponse(401, { detail: 'no refresh cookie' }),
      );
      await expect(apiFetch('/meetings')).rejects.toMatchObject({
        status: 401, detail: 'token expired',
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not attempt a refresh for the auth-flow endpoints themselves', async () => {
      const handler = vi.fn();
      setSessionExpiredHandler(handler);
      const spy = stubFetchSequence(jsonResponse(401, { detail: 'invalid credentials' }));
      await expect(apiFetch('/auth/login', { method: 'POST' })).rejects.toMatchObject({
        status: 401, detail: 'invalid credentials',
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
    });

    it('throws the retried response’s error if it still fails after a refresh', async () => {
      stubFetchSequence(
        jsonResponse(401, { detail: 'token expired' }),
        new Response(null, { status: 200 }),
        jsonResponse(500, { message: 'database unavailable' }),
      );
      await expect(apiFetch('/meetings')).rejects.toMatchObject({
        status: 500, detail: 'database unavailable',
      });
    });
  });
});
