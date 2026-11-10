-- One successor per source task, even if the source is reopened and completed again.
CREATE TABLE task_recurrence_occurrences (
  source_task_id BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  next_task_id BIGINT REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX idx_task_recurrence_next ON task_recurrence_occurrences(next_task_id);

-- Older single-task completions recorded the source on the successor event.
-- Preserve those links, without guessing from names or dates.
INSERT INTO task_recurrence_occurrences (source_task_id, next_task_id)
SELECT DISTINCT ON (source.id) source.id, successor.id
FROM domain_events e
JOIN tasks source ON source.id = CASE
  WHEN e.data->>'from_task_id' ~ '^[0-9]{1,18}$' THEN (e.data->>'from_task_id')::bigint
END
LEFT JOIN tasks successor ON successor.id = e.subject_id
WHERE e.type = 'task.created' AND e.subject_type = 'task'
  AND e.data->'recurrence' = 'true'::jsonb
ORDER BY source.id, e.id;
