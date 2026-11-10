CREATE TABLE automation_due_soon_scans (
  rule_id BIGINT NOT NULL REFERENCES project_rules(id) ON DELETE CASCADE,
  days INTEGER NOT NULL CHECK (days BETWEEN 0 AND 365),
  scan_from DATE NOT NULL,
  PRIMARY KEY (rule_id, days)
);
