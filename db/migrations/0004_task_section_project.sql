-- A section belongs to the primary or secondary project holding the placement.
-- Leave existing placements readable and enforce the invariant on new changes.
ALTER TABLE sections ADD CONSTRAINT sections_project_id_id_key UNIQUE (project_id, id);

ALTER TABLE tasks ADD CONSTRAINT tasks_section_project_fkey
  FOREIGN KEY (project_id, section_id) REFERENCES sections(project_id, id)
  ON DELETE SET NULL (section_id) NOT VALID;

ALTER TABLE task_project_memberships ADD CONSTRAINT task_memberships_section_project_fkey
  FOREIGN KEY (project_id, section_id) REFERENCES sections(project_id, id)
  ON DELETE SET NULL (section_id) NOT VALID;
