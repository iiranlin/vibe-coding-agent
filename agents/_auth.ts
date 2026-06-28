import { createClerkClient } from '@clerk/backend';

type HeaderRecord = Record<string, string | string[] | undefined>;

export type ClerkAuthContext = {
  clerkUserId: string;
  systemUserId: string;
  userId: string;
  sessionId?: string | null;
  email?: string | null;
  displayName?: string | null;
};

export class AuthError extends Error {
  constructor(
    public readonly reason: string,
    public readonly status = 401,
  ) {
    super(reason);
    this.name = 'AuthError';
  }
}

function pickEnvValue(context: any, key: string) {
  const value = context?.env?.[key] ?? process.env?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function headerValue(headers: Headers | HeaderRecord | undefined | null, name: string) {
  if (!headers) return '';
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) || '';
  }
  const record = headers as HeaderRecord;
  const value = record[name] ?? record[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function normalizeHeaders(headers: Headers | HeaderRecord | undefined | null) {
  const result = new Headers();
  if (!headers) return result;
  if (typeof (headers as Headers).forEach === 'function') {
    (headers as Headers).forEach((value, key) => result.set(key, value));
    return result;
  }
  for (const [key, value] of Object.entries(headers as HeaderRecord)) {
    if (Array.isArray(value)) {
      result.set(key, value.join(', '));
    } else if (typeof value === 'string') {
      result.set(key, value);
    }
  }
  return result;
}

function getRequestUrl(context: any, headers: Headers | HeaderRecord | undefined | null) {
  const request = context?.request || {};
  const rawUrl = typeof request.url === 'string'
    ? request.url
    : typeof request.rawUrl === 'string'
      ? request.rawUrl
      : typeof request.path === 'string'
        ? request.path
        : '';
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const host = headerValue(headers, 'host') || 'localhost';
  const path = rawUrl.startsWith('/') ? rawUrl : '/';
  const proto = headerValue(headers, 'x-forwarded-proto') || 'https';
  return `${proto}://${host}${path}`;
}

function getSystemUserId(clerkUserId: string) {
  return `clerk:${clerkUserId}`;
}

function getPrimaryEmail(user: Awaited<ReturnType<ReturnType<typeof createClerkClient>['users']['getUser']>>) {
  return user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress
    || user.emailAddresses[0]?.emailAddress
    || null;
}

function getDisplayName(user: Awaited<ReturnType<ReturnType<typeof createClerkClient>['users']['getUser']>>) {
  return user.fullName || user.username || getPrimaryEmail(user) || user.id;
}

function formatMissingClerkConfigError(missingKeys: string[]) {
  return `Clerk is not configured. Missing environment variables: ${missingKeys.join(', ')}.`;
}

export async function requireClerkAuth(context: any): Promise<ClerkAuthContext> {
  const secretKey = pickEnvValue(context, 'CLERK_SECRET_KEY');
  const publishableKey = pickEnvValue(context, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')
    || pickEnvValue(context, 'CLERK_PUBLISHABLE_KEY');

  const missingKeys = [
    ...(!secretKey ? ['CLERK_SECRET_KEY'] : []),
    ...(!publishableKey ? ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] : []),
  ];
  if (!secretKey || !publishableKey) {
    throw new AuthError(formatMissingClerkConfigError(missingKeys), 500);
  }

  const headers = normalizeHeaders(context?.request?.headers);
  const request = new Request(getRequestUrl(context, context?.request?.headers), {
    method: typeof context?.request?.method === 'string' ? context.request.method : 'GET',
    headers,
  });
  const clerk = createClerkClient({ secretKey, publishableKey });
  const requestState = await clerk.authenticateRequest(request, {
    acceptsToken: 'session_token',
  });

  if (!requestState.isAuthenticated) {
    throw new AuthError(requestState.reason || 'Authentication required.');
  }

  const auth = requestState.toAuth();
  if (!auth.isAuthenticated || !auth.userId) {
    throw new AuthError('Authentication required.');
  }

  const clerkUser = await clerk.users.getUser(auth.userId);
  const systemUserId = getSystemUserId(auth.userId);
  return {
    clerkUserId: auth.userId,
    systemUserId,
    // Kept for existing callers; this is currently the Clerk user id.
    userId: auth.userId,
    sessionId: auth.sessionId,
    email: getPrimaryEmail(clerkUser),
    displayName: getDisplayName(clerkUser),
  };
}

export function authErrorResponse(error: AuthError) {
  return new Response(JSON.stringify({
    ok: false,
    error: error.reason,
  }), {
    status: error.status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
