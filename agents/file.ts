import { runFileReadPipeline } from './_pipelines';
import { AuthError, authErrorResponse, requireSupabaseAuth } from './_auth';
import { ensureAppUser, UsageConfigurationError, UsagePermissionError } from '../lib/usage';

function usageErrorResponse(error: unknown) {
  const reason = error instanceof UsageConfigurationError
    ? 'Usage quota database is not configured.'
    : error instanceof UsagePermissionError
      ? error.reason
      : error instanceof Error
        ? error.message
        : 'Unable to verify user permissions.';
  const status = error instanceof UsagePermissionError ? error.status : 500;
  return new Response(JSON.stringify({ ok: false, error: reason }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequest(context: any) {
  let auth;
  try {
    auth = await requireSupabaseAuth(context);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    throw error;
  }

  try {
    const user = await ensureAppUser({
      userId: auth.userId,
      email: auth.email,
      displayName: auth.displayName,
    }, { context });
    if (user.status !== 'active') {
      throw new UsagePermissionError('user_disabled', 403);
    }
  } catch (error) {
    return usageErrorResponse(error);
  }

  return runFileReadPipeline(context, { auth });
}
