import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = !error ? data?.claims : null;

  return NextResponse.json({
    signedIn: Boolean(claims?.sub),
    user: claims?.sub
      ? {
          id: claims.sub,
          email: typeof claims.email === 'string' ? claims.email : null,
        }
      : null,
  }, {
    headers: {
      'cache-control': 'private, no-store',
    },
  });
}
