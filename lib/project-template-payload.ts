/** Persisted v2 project-template payload. Shared by snapshots and built-ins. */
export type TemplateValue = {
  field_index: number;
  value_text?: string | null;
  value_number?: number | null;
  value_date?: string | null;
  value_json?: unknown;
};

export type TemplateTask = {
  name?: string;
  description?: string;
  description_doc?: unknown;
  assignee_id?: number | null;
  due_offset_days?: number | null;
  start_offset_days?: number | null;
  status?: string;
  progress?: number;
  is_milestone?: boolean;
  subtasks?: TemplateTask[];
  values?: TemplateValue[];
};

export type TemplateField = {
  name?: string;
  field_type?: string;
  options?: unknown;
  description?: string;
  config?: unknown;
  position?: number;
  access_level?: string;
  editor_ids?: unknown;
};

export type TemplateRule = {
  name?: string;
  description?: string;
  definition?: unknown;
  enabled?: boolean;
};

export type ProjectTemplatePayload = {
  version?: number;
  project?: {
    description?: string;
    color?: string | null;
    icon?: string | null;
    status?: string;
    status_color?: string;
    status_options?: string[];
    status_field_name?: string;
    status_field_enabled?: boolean;
    owner_id?: number | null;
    team_id?: number | null;
    settings?: unknown;
  };
  sections?: { name?: string; tasks?: TemplateTask[] }[];
  custom_fields?: TemplateField[];
  rules?: TemplateRule[];
};
