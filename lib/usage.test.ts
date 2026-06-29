import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureAppUser } from './usage';

const userRow = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  display_name: 'Test User',
  locale: 'zh-CN',
  role: 'user',
  status: 'active',
  token_quota: 100,
  token_used: 0,
  remaining_tokens: 100,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  last_seen_at: '2026-01-01T00:00:00.000Z',
};

function mockRpcResponse() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([userRow]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Supabase usage RPC authentication', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not send a non-JWT secret key as a Bearer token', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const fetchMock = mockRpcResponse();

    await ensureAppUser({
      userId: userRow.id,
      email: userRow.email,
      displayName: userRow.display_name,
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('apikey')).toBe('sb_secret_test');
    expect(headers.get('authorization')).toBeNull();
  });

  it('keeps the legacy service-role JWT in the Bearer header', async () => {
    const serviceRoleJwt = 'eyJheader.eyJpayload.signature';
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', serviceRoleJwt);
    const fetchMock = mockRpcResponse();

    await ensureAppUser({ userId: userRow.id });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('apikey')).toBe(serviceRoleJwt);
    expect(headers.get('authorization')).toBe(`Bearer ${serviceRoleJwt}`);
  });
});
