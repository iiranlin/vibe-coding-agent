-- Supabase Auth user binding, admin bootstrap, quota allocation, and usage ledger.
-- This migration intentionally removes the previous identity-bound quota data.
-- Run it once in the Supabase SQL Editor before deploying this version.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_user_role') THEN
    CREATE TYPE app_user_role AS ENUM ('user', 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_user_status') THEN
    CREATE TYPE app_user_status AS ENUM ('active', 'disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'usage_event_type') THEN
    CREATE TYPE usage_event_type AS ENUM ('reserve', 'finalize', 'grant', 'adjust');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'usage_event_status') THEN
    CREATE TYPE usage_event_status AS ENUM ('reserved', 'finalized', 'failed');
  END IF;
END $$;

DROP FUNCTION IF EXISTS app_finalize_usage(TEXT, UUID, BIGINT, JSONB);
DROP FUNCTION IF EXISTS app_reserve_tokens(TEXT, BIGINT, TEXT, JSONB);
DROP FUNCTION IF EXISTS app_admin_update_user_quota(TEXT, UUID, BIGINT, app_user_status);
DROP FUNCTION IF EXISTS app_list_users(TEXT);
DROP FUNCTION IF EXISTS app_assert_admin(TEXT);
DROP FUNCTION IF EXISTS app_get_user(TEXT);
DROP FUNCTION IF EXISTS app_ensure_user(TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT);
DROP TABLE IF EXISTS usage_events CASCADE;
DROP TABLE IF EXISTS app_users CASCADE;

CREATE TABLE app_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  locale TEXT NOT NULL DEFAULT 'zh',
  role app_user_role NOT NULL DEFAULT 'user',
  status app_user_status NOT NULL DEFAULT 'active',
  token_quota BIGINT NOT NULL DEFAULT 0 CHECK (token_quota >= 0),
  token_used BIGINT NOT NULL DEFAULT 0 CHECK (token_used >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  event_type usage_event_type NOT NULL,
  status usage_event_status NOT NULL DEFAULT 'reserved',
  tokens BIGINT NOT NULL CHECK (tokens >= 0),
  reserved_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  actual_tokens BIGINT NOT NULL DEFAULT 0 CHECK (actual_tokens >= 0),
  conversation_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX app_users_role_idx ON app_users (role);
CREATE INDEX app_users_created_at_idx ON app_users (created_at DESC);
CREATE INDEX usage_events_user_created_idx ON usage_events (user_id, created_at DESC);
CREATE INDEX usage_events_conversation_idx ON usage_events (conversation_id);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE app_users, usage_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE app_users, usage_events TO service_role;

CREATE OR REPLACE FUNCTION app_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_users_touch_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW
EXECUTE FUNCTION app_touch_updated_at();

CREATE OR REPLACE FUNCTION app_user_projection(p_user app_users)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  locale TEXT,
  role app_user_role,
  status app_user_status,
  token_quota BIGINT,
  token_used BIGINT,
  remaining_tokens BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p_user.id,
    p_user.email,
    p_user.display_name,
    p_user.locale,
    p_user.role,
    p_user.status,
    p_user.token_quota,
    p_user.token_used,
    GREATEST(0, p_user.token_quota - p_user.token_used),
    p_user.created_at,
    p_user.updated_at,
    p_user.last_seen_at;
$$;

CREATE OR REPLACE FUNCTION app_ensure_user(
  p_user_id UUID,
  p_email TEXT DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL,
  p_locale TEXT DEFAULT 'zh',
  p_default_token_quota BIGINT DEFAULT 0,
  p_admin_initial_token_quota BIGINT DEFAULT 1000000
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  locale TEXT,
  role app_user_role,
  status app_user_status,
  token_quota BIGINT,
  token_used BIGINT,
  remaining_tokens BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user app_users%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'missing_user_id';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('vibe_agent_first_admin_lock'));

  INSERT INTO app_users AS target (
    id,
    email,
    display_name,
    locale,
    token_quota,
    last_seen_at
  )
  VALUES (
    p_user_id,
    NULLIF(p_email, ''),
    NULLIF(p_display_name, ''),
    COALESCE(NULLIF(p_locale, ''), 'zh'),
    GREATEST(0, p_default_token_quota),
    NOW()
  )
  ON CONFLICT ON CONSTRAINT app_users_pkey DO UPDATE SET
    email = COALESCE(NULLIF(EXCLUDED.email, ''), target.email),
    display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), target.display_name),
    locale = COALESCE(NULLIF(EXCLUDED.locale, ''), target.locale),
    last_seen_at = NOW()
  RETURNING target.* INTO v_user;

  IF NOT EXISTS (
    SELECT 1 FROM app_users AS u WHERE u.role = 'admin' AND u.id <> v_user.id
  ) THEN
    UPDATE app_users AS u
    SET
      role = 'admin',
      status = 'active',
      token_quota = GREATEST(u.token_quota, p_admin_initial_token_quota)
    WHERE u.id = v_user.id
    RETURNING u.* INTO v_user;
  END IF;

  RETURN QUERY SELECT * FROM app_user_projection(v_user);
END;
$$;

CREATE OR REPLACE FUNCTION app_get_user(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  locale TEXT,
  role app_user_role,
  status app_user_status,
  token_quota BIGINT,
  token_used BIGINT,
  remaining_tokens BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.*
  FROM app_users AS u
  CROSS JOIN LATERAL app_user_projection(u) AS p
  WHERE u.id = p_user_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_assert_admin(p_admin_user_id UUID)
RETURNS app_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin app_users%ROWTYPE;
BEGIN
  SELECT * INTO v_admin
  FROM app_users AS u
  WHERE u.id = p_admin_user_id
  LIMIT 1;

  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role <> 'admin' THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN v_admin;
END;
$$;

CREATE OR REPLACE FUNCTION app_list_users(p_admin_user_id UUID)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  locale TEXT,
  role app_user_role,
  status app_user_status,
  token_quota BIGINT,
  token_used BIGINT,
  remaining_tokens BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM app_assert_admin(p_admin_user_id);

  RETURN QUERY
  SELECT p.*
  FROM app_users AS u
  CROSS JOIN LATERAL app_user_projection(u) AS p
  ORDER BY u.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app_admin_update_user_quota(
  p_admin_user_id UUID,
  p_target_user_id UUID,
  p_token_quota BIGINT,
  p_status app_user_status DEFAULT 'active'
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  locale TEXT,
  role app_user_role,
  status app_user_status,
  token_quota BIGINT,
  token_used BIGINT,
  remaining_tokens BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user app_users%ROWTYPE;
BEGIN
  PERFORM app_assert_admin(p_admin_user_id);

  UPDATE app_users AS u
  SET
    token_quota = GREATEST(0, p_token_quota),
    status = COALESCE(p_status, 'active')
  WHERE u.id = p_target_user_id
  RETURNING u.* INTO v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  INSERT INTO usage_events (
    user_id,
    event_type,
    status,
    tokens,
    metadata,
    finalized_at
  )
  VALUES (
    v_user.id,
    'adjust',
    'finalized',
    0,
    jsonb_build_object(
      'adminUserId', p_admin_user_id,
      'tokenQuota', p_token_quota,
      'status', p_status
    ),
    NOW()
  );

  RETURN QUERY SELECT * FROM app_user_projection(v_user);
END;
$$;

CREATE OR REPLACE FUNCTION app_reserve_tokens(
  p_user_id UUID,
  p_tokens BIGINT,
  p_conversation_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  allowed BOOLEAN,
  reason TEXT,
  event_id UUID,
  reserved_tokens BIGINT,
  remaining_tokens BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user app_users%ROWTYPE;
  v_event_id UUID;
  v_tokens BIGINT := GREATEST(1, p_tokens);
BEGIN
  SELECT * INTO v_user
  FROM app_users AS u
  WHERE u.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'user_not_found', NULL::UUID, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  IF v_user.status <> 'active' THEN
    RETURN QUERY SELECT FALSE, 'user_disabled', NULL::UUID, 0::BIGINT, GREATEST(0, v_user.token_quota - v_user.token_used);
    RETURN;
  END IF;

  IF v_user.token_quota - v_user.token_used < v_tokens THEN
    RETURN QUERY SELECT FALSE, 'insufficient_quota', NULL::UUID, 0::BIGINT, GREATEST(0, v_user.token_quota - v_user.token_used);
    RETURN;
  END IF;

  UPDATE app_users AS u
  SET token_used = u.token_used + v_tokens
  WHERE u.id = v_user.id
  RETURNING u.* INTO v_user;

  INSERT INTO usage_events (
    user_id,
    event_type,
    status,
    tokens,
    reserved_tokens,
    conversation_id,
    metadata
  )
  VALUES (
    v_user.id,
    'reserve',
    'reserved',
    v_tokens,
    v_tokens,
    p_conversation_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_event_id, v_tokens, GREATEST(0, v_user.token_quota - v_user.token_used);
END;
$$;

CREATE OR REPLACE FUNCTION app_finalize_usage(
  p_user_id UUID,
  p_event_id UUID,
  p_actual_tokens BIGINT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  locale TEXT,
  role app_user_role,
  status app_user_status,
  token_quota BIGINT,
  token_used BIGINT,
  remaining_tokens BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event usage_events%ROWTYPE;
  v_user app_users%ROWTYPE;
  v_actual BIGINT := GREATEST(0, p_actual_tokens);
  v_delta BIGINT;
BEGIN
  SELECT * INTO v_event
  FROM usage_events AS e
  WHERE e.id = p_event_id
    AND e.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'usage_event_not_found';
  END IF;

  SELECT * INTO v_user
  FROM app_users AS u
  WHERE u.id = v_event.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  IF v_event.status = 'finalized' THEN
    RETURN QUERY SELECT * FROM app_user_projection(v_user);
    RETURN;
  END IF;

  v_delta := v_actual - v_event.reserved_tokens;

  UPDATE app_users AS u
  SET token_used = GREATEST(0, u.token_used + v_delta)
  WHERE u.id = v_user.id
  RETURNING u.* INTO v_user;

  UPDATE usage_events AS e
  SET
    status = 'finalized',
    event_type = 'finalize',
    actual_tokens = v_actual,
    tokens = v_actual,
    metadata = COALESCE(e.metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
    finalized_at = NOW()
  WHERE e.id = v_event.id;

  RETURN QUERY SELECT * FROM app_user_projection(v_user);
END;
$$;

REVOKE EXECUTE ON FUNCTION app_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app_user_projection(app_users) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app_ensure_user(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app_get_user(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app_assert_admin(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app_list_users(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app_admin_update_user_quota(UUID, UUID, BIGINT, app_user_status) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app_reserve_tokens(UUID, BIGINT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app_finalize_usage(UUID, UUID, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION app_user_projection(app_users) TO service_role;
GRANT EXECUTE ON FUNCTION app_ensure_user(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION app_get_user(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION app_assert_admin(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION app_list_users(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION app_admin_update_user_quota(UUID, UUID, BIGINT, app_user_status) TO service_role;
GRANT EXECUTE ON FUNCTION app_reserve_tokens(UUID, BIGINT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION app_finalize_usage(UUID, UUID, BIGINT, JSONB) TO service_role;
