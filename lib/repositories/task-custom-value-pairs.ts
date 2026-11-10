export type TaskCustomValuePairs = [fieldId: string, value: string][] | null;

/** Custom values for the task aliased as t in a project export or table snapshot. */
export const TASK_CUSTOM_VALUE_PAIRS = `(
  SELECT jsonb_agg(jsonb_build_array(v.field_id::text, CASE
    WHEN f.field_type IN ('number', 'timer')
      THEN COALESCE(v.value_number::text, v.value_text, '')
    ELSE COALESCE(v.value_text, v.value_number::text, '')
  END) ORDER BY v.field_id)
  FROM task_custom_values v JOIN custom_fields f ON f.id = v.field_id
  WHERE v.task_id = t.id AND f.deleted_at IS NULL
) AS custom_values`;
