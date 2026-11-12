-- Personal navigation preferences only; project/task data and recents stay intact.
CREATE TABLE user_sidebar_project_order (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position BIGINT NOT NULL CHECK (position > 0),
  PRIMARY KEY (user_id, project_id)
);
