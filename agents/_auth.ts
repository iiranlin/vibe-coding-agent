import { createServerClient } from '@supabase/ssr';
import { getSupabasePublicConfig } from '../lib/supabase/config';

type HeaderRecord = Record<string, string | string[] | undefined>;

export type SupabaseAuthContext = {
  supabaseUserId: string;
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

function headerValue(headers: Headers | HeaderRecord | undefined | null, name: string) {
  if (!headers) return '';
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) || '';
  }
  const record = headers as HeaderRecord;
  const value = record[name] ?? record[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function parseCookies(value: string) {
  if (!value) return [];
  return value.split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return [];
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      return [{ name, value: decodeURIComponent(rawValue) }];
    } catch {
      return [{ name, value: rawValue }];
    }
  });
}

function getBearerToken(headers: Headers | HeaderRecord | undefined | null) {
  const authorization = headerValue(headers, 'authorization');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function getDisplayName(claims: Record<string, unknown>) {
  const metadata = claims.user_metadata && typeof claims.user_metadata === 'object'
    ? claims.user_metadata as Record<string, unknown>
    : {};
  const name = metadata.full_name || metadata.name || metadata.display_name;
  if (typeof name === 'string' && name.trim()) {
    return name.trim();
  }
  return typeof claims.email === 'string' ? claims.email : null;
}

export async function requireSupabaseAuth(context: any): Promise<SupabaseAuthContext> {
  let config;
  try {
    config = getSupabasePublicConfig(context);
  } catch (error) {
    throw new AuthError(error instanceof Error ? error.message : 'Supabase Auth is not configured.', 500);
  }

  const requestHeaders = context?.request?.headers;
  const cookies = parseCookies(headerValue(requestHeaders, 'cookie'));
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookies;
      },
      setAll() {
        // Agent responses do not own the browser session; Next.js Proxy refreshes it.
      },
    },
  });
  const bearerToken = getBearerToken(requestHeaders);
  const { data, error } = bearerToken
    ? await supabase.auth.getClaims(bearerToken)
    : await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  const userId = typeof claims?.sub === 'string' ? claims.sub : '';
  if (error || !userId) {
    throw new AuthError('Authentication required.');
  }

  return {
    supabaseUserId: userId,
    systemUserId: `supabase:${userId}`,
    userId,
    sessionId: typeof claims.session_id === 'string' ? claims.session_id : null,
    email: typeof claims.email === 'string' ? claims.email : null,
    displayName: getDisplayName(claims),
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
