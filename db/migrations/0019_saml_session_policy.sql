-- Legacy sessions have no authentication provenance. Treat them as password
-- sessions rather than assuming that an old credential completed SAML.
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'password';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='user_sessions'::regclass
      AND conname='user_sessions_auth_method_check') THEN
    ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_auth_method_check
      CHECK(auth_method IN ('password','saml'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_session_saml_policy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE mode TEXT; actor RECORD;
BEGIN
  -- Session creation takes a shared policy lock before the row is inserted.
  -- A settings update takes the conflicting row lock before deleting sessions,
  -- so a password login cannot commit just behind mandatory-SAML revocation.
  SELECT saml_mode INTO mode FROM workspace_security
    WHERE workspace_id=(SELECT id FROM workspaces ORDER BY id LIMIT 1) FOR SHARE;
  -- Classification updates use policy -> user -> sessions too. Waiting for
  -- this row lock must happen before the session exists, so an old admin/guest
  -- snapshot cannot insert a credential after the classification's DELETE.
  SELECT u.is_admin,u.is_guest INTO actor FROM users u WHERE u.id=NEW.user_id FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NEW.auth_method <> 'saml' AND mode IN ('required','members_only') AND NOT actor.is_admin
      AND (mode='required' OR NOT actor.is_guest) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS user_sessions_saml_policy ON user_sessions;
CREATE TRIGGER user_sessions_saml_policy BEFORE INSERT ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_session_saml_policy();

-- Authenticated identity and provenance are fixed for the lifetime of a
-- credential. Rotation creates a new row; expiry maintenance remains allowed.
-- Rejecting changes also avoids an UPDATE row -> policy/user lock inversion.
CREATE OR REPLACE FUNCTION preserve_session_authentication() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.auth_method IS DISTINCT FROM OLD.auth_method THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Session authentication provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS user_sessions_authentication_immutable ON user_sessions;
CREATE TRIGGER user_sessions_authentication_immutable BEFORE UPDATE OF user_id,auth_method ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION preserve_session_authentication();

CREATE OR REPLACE FUNCTION revoke_password_sessions_for_saml() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id=(SELECT id FROM workspaces ORDER BY id LIMIT 1)
      AND NEW.saml_mode IN ('required','members_only') THEN
    DELETE FROM user_sessions s USING users u WHERE s.user_id=u.id
      AND s.auth_method <> 'saml' AND NOT u.is_admin
      AND (NEW.saml_mode='required' OR NOT u.is_guest);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS workspace_security_saml_revoke ON workspace_security;
CREATE TRIGGER workspace_security_saml_revoke AFTER UPDATE OF saml_mode ON workspace_security
  FOR EACH ROW EXECUTE FUNCTION revoke_password_sessions_for_saml();

-- Classification changes also invalidate old password credentials. In
-- particular, a guest becoming a member must not keep a credential that could
-- become usable again if its classification changes back later.
CREATE OR REPLACE FUNCTION lock_saml_policy_for_user_classification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Acquire before the UPDATE statement locks users, matching credential flows.
  PERFORM workspace_id FROM workspace_security
    WHERE workspace_id=(SELECT id FROM workspaces ORDER BY id LIMIT 1) FOR SHARE;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS users_saml_policy_lock ON users;
CREATE TRIGGER users_saml_policy_lock BEFORE UPDATE OF is_admin,is_guest ON users
  FOR EACH STATEMENT EXECUTE FUNCTION lock_saml_policy_for_user_classification();

CREATE OR REPLACE FUNCTION revoke_password_sessions_on_classification_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE mode TEXT;
BEGIN
  SELECT saml_mode INTO mode FROM workspace_security
    WHERE workspace_id=(SELECT id FROM workspaces ORDER BY id LIMIT 1);
  IF (mode='required' AND (NOT OLD.is_admin OR NOT NEW.is_admin)) OR
      (mode='members_only' AND ((NOT OLD.is_admin AND NOT OLD.is_guest) OR (NOT NEW.is_admin AND NOT NEW.is_guest))) THEN
    DELETE FROM user_sessions WHERE user_id=NEW.id AND auth_method<>'saml';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS users_saml_session_classification ON users;
CREATE TRIGGER users_saml_session_classification AFTER UPDATE OF is_admin,is_guest ON users
  FOR EACH ROW WHEN (OLD.is_admin IS DISTINCT FROM NEW.is_admin OR OLD.is_guest IS DISTINCT FROM NEW.is_guest)
  EXECUTE FUNCTION revoke_password_sessions_on_classification_change();

-- Apply the same rule to a pre-upgrade mandatory policy, without rewriting
-- the policy or invalidating the emergency administrator exception.
DELETE FROM user_sessions s USING users u,workspace_security w
  WHERE s.user_id=u.id AND w.workspace_id=(SELECT id FROM workspaces ORDER BY id LIMIT 1)
    AND s.auth_method <> 'saml' AND NOT u.is_admin
    AND (w.saml_mode='required' OR (w.saml_mode='members_only' AND NOT u.is_guest));
