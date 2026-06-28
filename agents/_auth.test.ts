import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, requireClerkAuth } from './_auth';

const clerkMocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    authenticateRequest: clerkMocks.authenticateRequest,
    users: {
      getUser: clerkMocks.getUser,
    },
  }),
}));

describe('requireClerkAuth', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('reports which Clerk environment variables are missing', async () => {
    vi.stubEnv('CLERK_SECRET_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', '');

    await expect(requireClerkAuth({ env: {} })).rejects.toMatchObject({
      name: 'AuthError',
      status: 500,
      reason: 'Clerk is not configured. Missing environment variables: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.',
    } satisfies Partial<AuthError>);
  });

  it('returns the authenticated Clerk profile used to initialize app users', async () => {
    clerkMocks.authenticateRequest.mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({
        isAuthenticated: true,
        userId: 'user_123',
        sessionId: 'session_123',
      }),
    });
    clerkMocks.getUser.mockResolvedValue({
      id: 'user_123',
      fullName: 'Ada Lovelace',
      username: 'ada',
      primaryEmailAddressId: 'email_123',
      emailAddresses: [
        { id: 'email_123', emailAddress: 'ada@example.com' },
      ],
    });

    await expect(requireClerkAuth({
      env: {
        CLERK_SECRET_KEY: 'test-secret',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'test-publishable',
      },
      request: {
        method: 'POST',
        url: 'https://example.com/chat',
        headers: new Headers(),
      },
    })).resolves.toMatchObject({
      clerkUserId: 'user_123',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
    expect(clerkMocks.getUser).toHaveBeenCalledWith('user_123');
  });
});
