import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL('./usage_permissions.sql', import.meta.url),
  'utf8',
);

describe('usage permissions migration', () => {
  it('creates enum types before using them in legacy function signatures', () => {
    expect(migrationSql.indexOf("CREATE TYPE app_user_status")).toBeLessThan(
      migrationSql.indexOf('DROP FUNCTION IF EXISTS app_admin_update_user_quota'),
    );
  });

  it('qualifies DML column references that can collide with RETURNS TABLE variables', () => {
    expect(migrationSql).toContain('ON CONFLICT ON CONSTRAINT app_users_pkey');
    expect(migrationSql).not.toMatch(/FROM app_users\s+WHERE/);
    expect(migrationSql).not.toMatch(/UPDATE app_users\s+SET/);
    expect(migrationSql).not.toMatch(/FROM usage_events\s+WHERE/);
    expect(migrationSql).not.toMatch(/UPDATE usage_events\s+SET/);
  });

  it('uses Supabase auth user ids without retaining legacy identity bindings', () => {
    expect(migrationSql.toLowerCase()).not.toContain(['cl', 'erk'].join(''));
    expect(migrationSql).toMatch(
      /id UUID PRIMARY KEY REFERENCES auth\.users\(id\) ON DELETE CASCADE/,
    );
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION app_ensure_user(\n  p_user_id UUID');
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION app_reserve_tokens(\n  p_user_id UUID');
  });

  it('keeps quota tables private to the server role', () => {
    expect(migrationSql).toContain('ALTER TABLE app_users ENABLE ROW LEVEL SECURITY');
    expect(migrationSql).toContain('ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY');
    expect(migrationSql).toMatch(
      /REVOKE ALL ON TABLE app_users, usage_events FROM PUBLIC, anon, authenticated/,
    );
  });

  it('restricts security definer RPCs to the service role', () => {
    expect(migrationSql).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/g);
    expect(migrationSql).toMatch(
      /REVOKE EXECUTE ON FUNCTION app_ensure_user[\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(migrationSql).toMatch(
      /GRANT EXECUTE ON FUNCTION app_ensure_user[\s\S]+TO service_role/,
    );
  });
});
