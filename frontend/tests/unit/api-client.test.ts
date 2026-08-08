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
});
