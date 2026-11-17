-- Secondary homes inherit the original order until they acquire their own placement.
ALTER TABLE task_project_memberships ADD COLUMN position double precision;
