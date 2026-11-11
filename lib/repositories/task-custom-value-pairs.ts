export type TaskCustomValuePairs = [fieldId: string, value: string][] | null;

/** SQL expressions are internal aliases/placeholders, never request values. */
export function taskCustomValuePairs(project?: string): string {
  return `(
  SELECT jsonb_agg(jsonb_build_array(v.field_id::text, CASE
    WHEN f.field_type IN ('number', 'timer')
      THEN COALESCE(v.value_number::text, v.value_text, '')
    ELSE COALESCE(v.value_text, v.value_number::text, '')
  END) ORDER BY v.field_id)
  FROM task_custom_values v JOIN custom_fields f ON f.id = v.field_id
  WHERE v.task_id = t.id AND f.deleted_at IS NULL${project ? ` AND f.project_id = ${project}` : ""}
) AS custom_values`;
}

/** Full values remain available for internal table snapshots. */
export const TASK_CUSTOM_VALUE_PAIRS = taskCustomValuePairs();
