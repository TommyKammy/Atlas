-- Atlas demo seed (disposable dev data). Workspace id 1 comes from init.sql.
-- Apply: docker cp app/db/seed.sql atlas-db:/tmp/seed.sql && docker exec atlas-db psql -U atlas -d atlas -f /tmp/seed.sql

-- Dev-only initial password for all seed users: atlas-dev-2026 (rotate before any exposure).
INSERT INTO users (id, name, email, is_guest, role_id, password_hash) VALUES
  (1, '管理者', 'admin@example.com', FALSE, 1, 'scrypt$16384$8$1$ab1bed03edea360c85720388e9ca9193$d11e6f4aacd3bb8f3f4a404abc2a915814661fadebc651e1a29a1bd3fb55ed97'),
  (2, '田中 太郎', 'tanaka@example.com', FALSE, 3, 'scrypt$16384$8$1$ab1bed03edea360c85720388e9ca9193$d11e6f4aacd3bb8f3f4a404abc2a915814661fadebc651e1a29a1bd3fb55ed97'),
  (3, '佐藤 花子', 'sato@example.com', FALSE, 3, 'scrypt$16384$8$1$ab1bed03edea360c85720388e9ca9193$d11e6f4aacd3bb8f3f4a404abc2a915814661fadebc651e1a29a1bd3fb55ed97'),
  (4, 'Dan Yu', 'dan@example.com', TRUE, 4, 'scrypt$16384$8$1$ab1bed03edea360c85720388e9ca9193$d11e6f4aacd3bb8f3f4a404abc2a915814661fadebc651e1a29a1bd3fb55ed97')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects (id, workspace_id, name) VALUES
  (1, 1, 'デモプロジェクト')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_members (project_id, user_id, role) VALUES
  (1, 1, 'admin'), (1, 2, 'editor'), (1, 3, 'editor'), (1, 4, 'editor')
ON CONFLICT DO NOTHING;

INSERT INTO sections (id, project_id, name, position) VALUES
  (1, 1, 'マイルストーン', 1000),
  (2, 1, '計画中', 2000),
  (3, 1, '進行中', 3000),
  (4, 1, '完了', 4000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, project_id, section_id, name, description, assignee_id, completed, start_on, due_on, progress, status, position) VALUES
  (1, 1, 1, 'キックオフ', 'プロジェクト開始の合意', 2, TRUE, '2026-10-01', '2026-10-03', 100, 'Done', 1000),
  (2, 1, 2, '要件定義', '要求を整理する', 2, FALSE, '2026-11-04', '2026-11-14', 20, '進行中', 1000),
  (3, 1, 2, '設計レビュー', '', 3, FALSE, '2026-11-10', '2026-11-18', 0, '未着手', 2000),
  (4, 1, 3, 'リスト表示の実装', 'セクション集計＋行描画', 1, FALSE, '2026-11-04', '2026-11-07', 60, '進行中', 1000),
  (5, 1, 4, '開発環境の準備', 'Colima + Postgres + Redis', 1, TRUE, '2026-11-03', '2026-11-04', 100, 'Done', 1000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, project_id, section_id, parent_task_id, name, assignee_id, completed, due_on, position) VALUES
  (6, 1, 2, 2, 'ステークホルダー聞き取り', 3, TRUE, '2026-11-07', 1000),
  (7, 1, 2, 2, '要求リスト化', 2, FALSE, '2026-11-12', 2000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO comments (task_id, author_id, body) VALUES
  (2, 3, '聞き取りは来週で調整します @田中 太郎'),
  (4, 1, '行のインライン追加まで完了')
ON CONFLICT DO NOTHING;

SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
SELECT setval('projects_id_seq', (SELECT MAX(id) FROM projects));
SELECT setval('sections_id_seq', (SELECT MAX(id) FROM sections));
SELECT setval('tasks_id_seq', (SELECT MAX(id) FROM tasks));
SELECT setval('comments_id_seq', (SELECT MAX(id) FROM comments));
