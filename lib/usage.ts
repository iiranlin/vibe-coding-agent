export type AppUserRole = 'user' | 'admin';
export type AppUserStatus = 'active' | 'disabled';

export type AppUser = {
  id: string;
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
  locale: string;
  role: AppUserRole;
  status: AppUserStatus;
  tokenQuota: number;
  tokenUsed: number;
  remainingTokens: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
};

export type UsageReservation = {
  eventId: string;
  clerkUserId: string;
  reservedTokens: number;
  remainingTokens: number;
};

export type ClerkUserProfile = {
  clerkUserId: string;
  email?: string | null;
  displayName?: string | null;
  locale?: string | null;
};

type SupabaseRpcOptions = {
  context?: any;
};

type SupabaseRpcError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

const DEFAULT_NEW_USER_QUOTA = 0;
const DEFAULT_ADMIN_INITIAL_QUOTA = 1_000_000;
export const DEFAULT_RUN_TOKEN_RESERVE = 20_000;

export class UsageConfigurationError extends Error {
  constructor(message = 'Usage database is not configured.') {
    super(message);
    this.name = 'UsageConfigurationError';
  }
}

export class UsagePermissionError extends Error {
  constructor(
    public readonly reason: string,
    public readonly status = 403,
  ) {
    super(reason);
    this.name = 'UsagePermissionError';
  }
}

function pickEnvValue(context: any, key: string) {
  const value = context?.env?.[key] ?? process.env?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function pickNumberEnv(context: any, key: string, fallback: number) {
  const raw = pickEnvValue(context, key);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function getSupabaseConfig(context?: any) {
  const url = pickEnvValue(context, 'SUPABASE_URL').replace(/\/+$/g, '');
  const serviceRoleKey = pickEnvValue(context, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    return null;
  }
  return { url, serviceRoleKey };
}

export function isUsageDatabaseConfigured(context?: any) {
  return Boolean(getSupabaseConfig(context));
}

function normalizeUser(row: any): AppUser {
  const tokenQuota = Number(row.token_quota ?? row.tokenQuota ?? 0);
  const tokenUsed = Number(row.token_used ?? row.tokenUsed ?? 0);
  return {
    id: String(row.id || ''),
    clerkUserId: String(row.clerk_user_id ?? row.clerkUserId ?? ''),
    email: row.email ? String(row.email) : null,
    displayName: row.display_name ?? row.displayName ? String(row.display_name ?? row.displayName) : null,
    locale: String(row.locale || 'zh'),
    role: row.role === 'admin' ? 'admin' : 'user',
    status: row.status === 'disabled' ? 'disabled' : 'active',
    tokenQuota,
    tokenUsed,
    remainingTokens: Number(row.remaining_tokens ?? Math.max(0, tokenQuota - tokenUsed)),
    createdAt: String(row.created_at ?? row.createdAt ?? ''),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? ''),
    lastSeenAt: row.last_seen_at ?? row.lastSeenAt ? String(row.last_seen_at ?? row.lastSeenAt) : null,
  };
}

async function callSupabaseRpc<T>(
  functionName: string,
  body: Record<string, unknown>,
  options: SupabaseRpcOptions = {},
): Promise<T> {
  const config = getSupabaseConfig(options.context);
  if (!config) {
    throw new UsageConfigurationError();
  }

  const response = await fetch(`${config.url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) as T | SupabaseRpcError : null;
  if (!response.ok) {
    const error = payload as SupabaseRpcError | null;
    throw new UsagePermissionError(
      error?.message || error?.details || `Supabase RPC ${functionName} failed.`,
      response.status,
    );
  }

  return payload as T;
}

function firstRow<T>(payload: T[] | T | null): T | null {
  if (Array.isArray(payload)) {
    return payload[0] || null;
  }
  return payload || null;
}

export async function ensureAppUserForClerkUser(
  profile: ClerkUserProfile,
  options: SupabaseRpcOptions = {},
): Promise<AppUser> {
  const defaultQuota = pickNumberEnv(options.context, 'DEFAULT_USER_TOKEN_QUOTA', DEFAULT_NEW_USER_QUOTA);
  const adminInitialQuota = pickNumberEnv(
    options.context,
    'ADMIN_INITIAL_TOKEN_QUOTA',
    DEFAULT_ADMIN_INITIAL_QUOTA,
  );
  const row = firstRow(await callSupabaseRpc<any[]>('app_ensure_user', {
    p_clerk_user_id: profile.clerkUserId,
    p_email: profile.email || null,
    p_display_name: profile.displayName || null,
    p_locale: profile.locale || 'zh',
    p_default_token_quota: defaultQuota,
    p_admin_initial_token_quota: adminInitialQuota,
  }, options));

  if (!row) {
    throw new UsagePermissionError('Unable to create or load user.', 500);
  }

  return normalizeUser(row);
}

export async function getAppUserByClerkUserId(
  clerkUserId: string,
  options: SupabaseRpcOptions = {},
): Promise<AppUser | null> {
  const row = firstRow(await callSupabaseRpc<any[]>('app_get_user', {
    p_clerk_user_id: clerkUserId,
  }, options));

  return row ? normalizeUser(row) : null;
}

export async function listUsersForAdmin(
  adminClerkUserId: string,
  options: SupabaseRpcOptions = {},
): Promise<AppUser[]> {
  const rows = await callSupabaseRpc<any[]>('app_list_users', {
    p_admin_clerk_user_id: adminClerkUserId,
  }, options);
  return (rows || []).map(normalizeUser);
}

export async function updateUserQuotaForAdmin(
  adminClerkUserId: string,
  targetUserId: string,
  tokenQuota: number,
  status: AppUserStatus,
  options: SupabaseRpcOptions = {},
): Promise<AppUser> {
  const row = firstRow(await callSupabaseRpc<any[]>('app_admin_update_user_quota', {
    p_admin_clerk_user_id: adminClerkUserId,
    p_target_user_id: targetUserId,
    p_token_quota: Math.max(0, Math.floor(tokenQuota)),
    p_status: status,
  }, options));

  if (!row) {
    throw new UsagePermissionError('Unable to update user quota.', 500);
  }

  return normalizeUser(row);
}

export async function reserveTokensForRun(
  clerkUserId: string,
  conversationId: string,
  options: SupabaseRpcOptions = {},
): Promise<UsageReservation> {
  const reserveTokens = Math.max(
    1,
    pickNumberEnv(options.context, 'RUN_TOKEN_RESERVE', DEFAULT_RUN_TOKEN_RESERVE),
  );
  const row = firstRow(await callSupabaseRpc<any[]>('app_reserve_tokens', {
    p_clerk_user_id: clerkUserId,
    p_tokens: reserveTokens,
    p_conversation_id: conversationId || null,
    p_metadata: { source: 'agent-run' },
  }, options));

  if (!row?.allowed) {
    throw new UsagePermissionError(String(row?.reason || 'insufficient_quota'), 403);
  }

  return {
    eventId: String(row.event_id),
    clerkUserId,
    reservedTokens: Number(row.reserved_tokens || reserveTokens),
    remainingTokens: Number(row.remaining_tokens || 0),
  };
}

export async function finalizeTokenUsage(
  reservation: UsageReservation,
  actualTokens: number,
  metadata: Record<string, unknown> = {},
  options: SupabaseRpcOptions = {},
): Promise<AppUser> {
  const row = firstRow(await callSupabaseRpc<any[]>('app_finalize_usage', {
    p_clerk_user_id: reservation.clerkUserId,
    p_event_id: reservation.eventId,
    p_actual_tokens: Math.max(0, Math.floor(actualTokens)),
    p_metadata: metadata,
  }, options));

  if (!row) {
    throw new UsagePermissionError('Unable to finalize token usage.', 500);
  }

  return normalizeUser(row);
}

export function estimateTokensFromText(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 1;
  }
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function extractUsageTokens(result: {
  usage?: any;
  modelUsage?: Record<string, any>;
  result?: string;
} | null | undefined) {
  if (!result) {
    return 0;
  }

  const usage = result.usage || {};
  const direct = [
    usage.inputTokens ?? usage.input_tokens,
    usage.outputTokens ?? usage.output_tokens,
    usage.cacheReadInputTokens ?? usage.cache_read_input_tokens,
    usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens,
  ].reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
  if (direct > 0) {
    return Math.floor(direct);
  }

  const modelUsage = result.modelUsage || {};
  const modelTotal = Object.values(modelUsage).reduce((sum, item: any) => {
    return sum
      + Number(item?.inputTokens || 0)
      + Number(item?.outputTokens || 0)
      + Number(item?.cacheReadInputTokens || 0)
      + Number(item?.cacheCreationInputTokens || 0);
  }, 0);
  return Math.floor(modelTotal);
}
