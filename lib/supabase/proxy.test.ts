import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}));

import { updateSession } from './proxy';

describe('updateSession', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('validates the JWT and forwards refreshed cookies', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'user-123' } } });
    mocks.createServerClient.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([
        {
          name: 'sb-project-auth-token',
          value: 'refreshed',
          options: { httpOnly: true, path: '/' },
        },
      ], { 'x-supabase-auth': 'refreshed' });
      return { auth: { getClaims: mocks.getClaims } };
    });

    const response = await updateSession(new NextRequest('https://code.example.com/'));

    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(response.cookies.get('sb-project-auth-token')?.value).toBe('refreshed');
    expect(response.headers.get('x-supabase-auth')).toBe('refreshed');
  });
});
