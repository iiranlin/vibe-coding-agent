type RuntimeContext = {
  env?: Record<string, unknown>;
};

function readEnv(context: RuntimeContext | undefined, key: string) {
  const value = context?.env?.[key] ?? process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function getSupabasePublicConfig(context?: RuntimeContext) {
  const url = (
    readEnv(context, 'SUPABASE_URL')
    || readEnv(context, 'NEXT_PUBLIC_SUPABASE_URL')
  ).replace(/\/+$/g, '');
  const publishableKey = (
    readEnv(context, 'SUPABASE_PUBLISHABLE_KEY')
    || readEnv(context, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
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
