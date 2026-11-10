-- Run only through the marker-verified critical-performance fresh-stack runner.
-- Fixed dates, identifiers relative to insertion order, and the same DAG are used
-- for both builds. No API/automation writes occur while measurements run.
BEGIN;
CREATE TEMP TABLE critical_bench_project AS
WITH created AS (
  INSERT INTO projects (workspace_id, name)
  VALUES (1, 'Critical path performance fixture') RETURNING id
)
SELECT id FROM created;

INSERT INTO project_members (project_id, user_id, role)
SELECT id, 1, 'admin' FROM critical_bench_project;
INSERT INTO sections (project_id, name, position)
SELECT p.id, 'Perf section ' || (s + 1), s * 1000
FROM critical_bench_project p CROSS JOIN generate_series(0, 9) s;
INSERT INTO project_tabs (project_id, tab_key, name, view_type, position, is_custom)
SELECT id, 'builtin:timeline', 'タイムライン', 'timeline', 4000, false
FROM critical_bench_project;

INSERT INTO tasks (
  project_id, section_id, name, created_by, completed, start_on, due_on,
  progress, status, recurrence, is_milestone, position
)
SELECT p.id, s.id, 'Perf task ' || (i + 1), 1, false,
  DATE '2026-11-10' + (i % 120),
  DATE '2026-11-10' + (i % 120) + CASE WHEN i % 7 = 0 THEN 5 ELSE 0 END,
  0, 'inbox', 'none', i % 37 = 0, i * 1000
FROM critical_bench_project p CROSS JOIN generate_series(0, 2999) i
JOIN sections s ON s.project_id = p.id AND s.position = (i / 300) * 1000;

INSERT INTO task_project_memberships (task_id, project_id, section_id)
SELECT t.id, t.project_id, t.section_id FROM tasks t
JOIN critical_bench_project p ON p.id = t.project_id;
INSERT INTO task_dependencies (task_id, depends_on_id)
SELECT t.id, predecessor.id
FROM tasks t JOIN critical_bench_project p ON p.id = t.project_id
JOIN tasks predecessor ON predecessor.project_id = t.project_id
  AND predecessor.position = t.position - 1000
WHERE (t.position::integer / 1000) % 30 <> 0;
INSERT INTO task_dependencies (task_id, depends_on_id)
SELECT t.id, predecessor.id
FROM tasks t JOIN critical_bench_project p ON p.id = t.project_id
JOIN tasks predecessor ON predecessor.project_id = t.project_id
  AND predecessor.position = t.position - 3000
WHERE (t.position::integer / 1000) % 30 > 3
  AND (t.position::integer / 1000) % 4 = 0;

COMMIT;
SELECT id FROM critical_bench_project;
