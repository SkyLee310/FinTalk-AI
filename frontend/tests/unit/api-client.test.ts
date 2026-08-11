import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../src/lib/api-client';

const BASE = 'http://localhost:8080';
process.env.NEXT_PUBLIC_API_BASE_URL = BASE;

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(response: Response) {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', spy);
  return spy;
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
});
