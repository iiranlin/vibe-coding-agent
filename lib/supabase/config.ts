type RuntimeContext = {
  env?: Record<string, unknown>;
};

function readEnv(contextValue: unknown, runtimeValue: unknown) {
  const value = contextValue ?? runtimeValue;
  return typeof value === 'string' ? value.trim() : '';
}

export function getSupabasePublicConfig(context?: RuntimeContext) {
  const url = (
    readEnv(context?.env?.SUPABASE_URL, process.env.SUPABASE_URL)
    || readEnv(context?.env?.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL)
  ).replace(/\/+$/g, '');
  const publishableKey = (
    readEnv(context?.env?.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_PUBLISHABLE_KEY)
    || readEnv(
      context?.env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    )
  );

  const missing = [
    ...(!url ? ['SUPABASE_URL'] : []),
    ...(!publishableKey ? ['SUPABASE_PUBLISHABLE_KEY'] : []),
  ];
  if (missing.length > 0) {
    throw new Error(`Supabase Auth is not configured. Missing environment variables: ${missing.join(', ')}.`);
  }

  return { url, publishableKey };
}
