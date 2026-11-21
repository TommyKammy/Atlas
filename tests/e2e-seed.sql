-- Additional fixtures for the isolated shell and browser suites.
UPDATE tasks SET completed_at = now() WHERE project_id = 1 AND completed AND completed_at IS NULL;

INSERT INTO project_tabs (project_id, tab_key, name, view_type, position)
VALUES
  (1, 'builtin:overview', '概要', 'overview', 0),
  (1, 'builtin:dashboard', 'ダッシュボード', 'dashboard', 1000),
  (1, 'builtin:list', 'リスト', 'list', 2000),
  (1, 'builtin:board', 'ボード', 'board', 3000),
  (1, 'builtin:timeline', 'タイムライン', 'timeline', 4000),
  (1, 'builtin:calendar', 'カレンダー', 'calendar', 5000),
  (1, 'builtin:messages', 'メッセージ', 'messages', 6000),
  (1, 'builtin:knowledge', '知識', 'knowledge', 7000),
  (1, 'builtin:files', 'ファイル', 'files', 8000),
  (1, 'builtin:forms', 'フォーム', 'forms', 9000)
ON CONFLICT (project_id, tab_key) DO NOTHING;
