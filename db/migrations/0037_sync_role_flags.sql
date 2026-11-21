-- Keep the legacy is_admin / is_guest flags in sync with the assigned
-- workspace role. The role is authoritative; only mismatched rows change.
UPDATE users u
SET is_admin = (r.base_level = 'admin'),
    is_guest = (r.base_level = 'guest')
FROM workspace_roles r
WHERE u.role_id = r.id
  AND (u.is_admin IS DISTINCT FROM (r.base_level = 'admin')
    OR u.is_guest IS DISTINCT FROM (r.base_level = 'guest'));
