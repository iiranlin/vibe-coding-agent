import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, requireSupabaseAuth } from './_auth';

const authMocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: authMocks.createServerClient,
}));

describe('requireSupabaseAuth', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('reports which Supabase Auth environment variables are missing', async () => {
    await expect(requireSupabaseAuth({ env: {} })).rejects.toMatchObject({
      name: 'AuthError',
      status: 500,
      reason: 'Supabase Auth is not configured. Missing environment variables: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY.',
    } satisfies Partial<AuthError>);
  });

  it('verifies a bearer JWT and returns its Supabase profile claims', async () => {
    authMocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: '2d3859ad-5ea7-4f78-a0f8-437ae7862fd2',
          email: 'ada@example.com',
          user_metadata: { full_name: 'Ada Lovelace' },
        },
      },
      error: null,
    });
    authMocks.createServerClient.mockReturnValue({ auth: { getClaims: authMocks.getClaims } });

    await expect(requireSupabaseAuth({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      },
      request: {
        headers: new Headers({ authorization: 'Bearer real.jwt.token' }),
      },
    })).resolves.toMatchObject({
      supabaseUserId: '2d3859ad-5ea7-4f78-a0f8-437ae7862fd2',
      systemUserId: 'supabase:2d3859ad-5ea7-4f78-a0f8-437ae7862fd2',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
    expect(authMocks.getClaims).toHaveBeenCalledWith('real.jwt.token');
  });

  it('passes SSR cookies to Supabase when no bearer token is present', async () => {
    authMocks.getClaims.mockResolvedValue({
      data: { claims: { sub: 'user-123' } },
      error: null,
    });
    authMocks.createServerClient.mockImplementation((_url, _key, options) => {
      expect(options.cookies.getAll()).toEqual([
        { name: 'sb-project-auth-token', value: 'cookie-value' },
        { name: 'theme', value: 'dark' },
      ]);
      return { auth: { getClaims: authMocks.getClaims } };
    });

    await requireSupabaseAuth({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      },
      request: {
        headers: new Headers({
          cookie: 'sb-project-auth-token=cookie-value; theme=dark',
        }),
      },
    });

    expect(authMocks.getClaims).toHaveBeenCalledWith();
  });
});
