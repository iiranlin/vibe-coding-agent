import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('Supabase public config bundling', () => {
  it('allows the server bundler to statically inject every supported environment variable', async () => {
    const source = readFileSync(resolve(process.cwd(), 'lib/supabase/config.ts'), 'utf8');
    const result = await transform(source, {
      define: {
        'process.env.SUPABASE_URL': JSON.stringify('https://server.supabase.co'),
        'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify('https://public.supabase.co'),
        'process.env.SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_server'),
        'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_public'),
      },
      loader: 'ts',
    });

    expect(result.code).toContain('https://server.supabase.co');
    expect(result.code).toContain('https://public.supabase.co');
    expect(result.code).toContain('sb_publishable_server');
    expect(result.code).toContain('sb_publishable_public');
    expect(result.code).not.toContain('process.env');
  });
});
