import { isCustomFieldType, isReadOnlyFieldType, normalizeCustomFieldConfig, type CustomField } from "../custom-fields";
import { db } from "../db";
import { canEditFieldValue } from "../field-access";
import { PROJECT_STATUS_COLORS } from "../project-status";
import { customConditionType, type ConditionType } from "./condition-schema";
import { SCHEDULED_TRIGGER_DEFAULTS } from "./trigger-defaults";
import { CONDITION_OPERATORS, RULE_LIMITS } from "./types";

export type DescriptorOption = { value: string | number; label: string };

export type DescriptorParam = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "boolean" | "password";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: DescriptorOption[];
};

export type TriggerDescriptor = {
  id: string;
  label: string;
  description: string;
  subject: "task" | "project" | "comment" | "form" | "webhook";
  days?: { label: string; default: number; help?: string };
};

export type ConditionFieldDescriptor = {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "boolean";
  group: string;
  options?: DescriptorOption[];
  valueType?: ConditionType;
};

export type ActionDescriptor = {
  id: string;
  label: string;
  description: string;
  requiresTask: boolean;
  params: DescriptorParam[];
};

export type RuleDescriptors = {
  triggers: TriggerDescriptor[];
  conditionFields: ConditionFieldDescriptor[];
  operators: typeof CONDITION_OPERATORS;
  actions: ActionDescriptor[];
  customFields: CustomField[];
  limits: typeof RULE_LIMITS;
};

export const TRIGGER_DESCRIPTORS: TriggerDescriptor[] = [
  { id: "task.created", label: "タスクが作成されたとき", description: "プロジェクトに新しいタスクが追加されたときに実行", subject: "task" },
  { id: "task.completed", label: "タスクが完了したとき", description: "タスクが完了状態になったときに実行", subject: "task" },
  { id: "task.reopened", label: "タスクが再開されたとき", description: "完了タスクが未完了に戻ったときに実行", subject: "task" },
  { id: "task.assigned", label: "担当者が変更されたとき", description: "タスクの担当者が変わったときに実行", subject: "task" },
  { id: "task.status_changed", label: "Statusが変更されたとき", description: "タスクのStatusが変わったときに実行", subject: "task" },
  { id: "task.due_changed", label: "期日が変更されたとき", description: "タスクの期日が設定・変更されたときに実行", subject: "task" },
  { id: "task.section_changed", label: "セクションが変更されたとき", description: "タスクが別のセクションに移動したときに実行", subject: "task" },
  { id: "task.custom_field_changed", label: "カスタムフィールドが変更されたとき", description: "タスクのカスタムフィールド値が変わったときに実行", subject: "task" },
  { id: "task.milestone_changed", label: "マイルストーンへの変換・解除がされたとき", description: "タスクがマイルストーンに変換されたとき、またはタスクに戻されたときに実行", subject: "task" },
  { id: "task.added_to_project", label: "プロジェクトに追加されたとき", description: "マルチホームなどでプロジェクトに追加されたときに実行", subject: "task" },
  { id: "comment.created", label: "コメントが追加されたとき", description: "タスクにコメントが投稿されたときに実行", subject: "task" },
  { id: "form.submitted", label: "フォームが送信されたとき", description: "プロジェクトのフォームからタスクが作成されたときに実行", subject: "task" },
  { id: "project.status_changed", label: "プロジェクトステータスが変更されたとき", description: "プロジェクトのステータス更新が投稿されたときに実行", subject: "project" },
  {
    id: "task.due_soon",
    label: "期日が近づいたとき",
    description: "期日まで指定日数以内になった未完了タスクに対して実行",
    subject: "task",
    days: { label: "何日前に実行", default: SCHEDULED_TRIGGER_DEFAULTS["task.due_soon"], help: "0を指定すると期日当日に実行します。" },
  },
  {
    id: "task.overdue",
    label: "期日を過ぎたとき",
    description: "期日を指定日数過ぎた未完了タスクに対して実行",
    subject: "task",
    days: { label: "何日過ぎたら実行", default: SCHEDULED_TRIGGER_DEFAULTS["task.overdue"] },
  },
  { id: "task.manual_rule", label: "手動で実行", description: "ルール画面から手動実行したときに実行", subject: "task" },
  {
    id: "webhook.received",
    label: "外部Webhookを受信したとき",
    description: "外部システムから受信WebhookへPOSTされたときに実行",
    subject: "webhook",
  },
];

export type ActionCapability = {
  id: string;
  label: string;
  description: string;
  requiresTask: boolean;
  /** Params that must be non-empty before the action can run. */
  requiredParams: string[];
};

/**
 * Single source of truth for action ids, labels and required params.
 * The rule builder's dynamic params and API validation both derive from this.
 */
export const ACTION_CAPABILITIES = [
  { id: "task.assign" as const, label: "担当者を変更", description: "タスクの担当者を設定・変更します。", requiresTask: true, requiredParams: ["user_id"] },
  { id: "task.set_status" as const, label: "Statusを変更", description: "タスクのStatusを変更します。", requiresTask: true, requiredParams: ["status"] },
  { id: "task.set_due_date" as const, label: "期日を変更", description: "期日を指定日付、または今日からの日数で設定します。", requiresTask: true, requiredParams: [] },
  { id: "task.move_section" as const, label: "セクションを移動", description: "タスクを指定セクションに移動します。", requiresTask: true, requiredParams: ["section_id"] },
  { id: "task.complete" as const, label: "タスクを完了", description: "タスクを完了状態にします。", requiresTask: true, requiredParams: [] },
  { id: "task.create" as const, label: "タスクを作成", description: "プロジェクトに新しいタスクを作成します。", requiresTask: false, requiredParams: ["name"] },
  { id: "task.add_comment" as const, label: "コメントを追加", description: "タスクにコメントを投稿します。変数が使えます。", requiresTask: true, requiredParams: ["body"] },
  { id: "task.create_subtask" as const, label: "サブタスクを作成", description: "対象タスクの下にサブタスクを作成します。", requiresTask: true, requiredParams: ["name"] },
  { id: "task.set_custom_field" as const, label: "カスタムフィールドを設定", description: "指定フィールドに値を設定します。", requiresTask: true, requiredParams: ["field_id"] },
  { id: "project.set_status" as const, label: "プロジェクトステータスを更新", description: "プロジェクトの現在ステータスを更新します。", requiresTask: false, requiredParams: ["status"] },
  { id: "task.add_to_project" as const, label: "別プロジェクトに追加", description: "タスクを別プロジェクトにマルチホームします。", requiresTask: true, requiredParams: ["project_id"] },
  { id: "webhook.post" as const, label: "Webhookを送信", description: "外部URLへJSONをPOSTします。", requiresTask: false, requiredParams: ["url"] },
] satisfies ActionCapability[];

export type ActionCapabilityId = (typeof ACTION_CAPABILITIES)[number]["id"];

export const ACTION_IDS = new Set<string>(ACTION_CAPABILITIES.map((action) => action.id));

export function requiredActionParams(capability: string): string[] {
  return ACTION_CAPABILITIES.find((action) => action.id === capability)?.requiredParams ?? [];
}

export const ACTION_DESCRIPTORS: Omit<ActionDescriptor, "params">[] = ACTION_CAPABILITIES.map(
  ({ id, label, description, requiresTask }) => ({ id, label, description, requiresTask }),
);

const userOptions = async (): Promise<DescriptorOption[]> => {
  const r = await db.query(
    "SELECT id, name FROM users WHERE deactivated_at IS NULL ORDER BY name, id",
  );
  return r.rows.map((row) => ({ value: Number(row.id), label: String(row.name) }));
};

const statusOptions = (projectStatusOptions: unknown): DescriptorOption[] => {
  const values = Array.isArray(projectStatusOptions)
    ? projectStatusOptions.map((value) => String(value)).filter(Boolean)
    : [];
  return values.map((value) => ({ value, label: value }));
};

const projectOptions = async (viewerId: number): Promise<DescriptorOption[]> => {
  const r = await db.query(
    `SELECT p.id, p.name FROM projects p
     WHERE p.archived_at IS NULL AND p.deleted_at IS NULL
       AND (
         EXISTS (SELECT 1 FROM users u WHERE u.id = $1 AND u.is_admin)
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1)
       )
     ORDER BY p.name, p.id`,
    [viewerId],
  );
  return r.rows.map((row) => ({ value: Number(row.id), label: String(row.name) }));
};

/** Build the metadata contract consumed by the rule builder and AI helper. */
export async function getRuleDescriptors(
  projectId: number,
  viewerId: number,
): Promise<RuleDescriptors> {  const [project, users, sections, fields, projects] = await Promise.all([
    db.query(
      `SELECT id, name, status, status_color, status_options, owner_id
       FROM projects WHERE id = $1::bigint`,
      [projectId],
    ),
    userOptions(),
    db.query("SELECT id, name FROM sections WHERE project_id = $1 ORDER BY position, id", [projectId]),
    db.query(
      `SELECT id, name, field_type, options, config, access_level, editor_ids FROM custom_fields
       WHERE project_id = $1 AND deleted_at IS NULL ORDER BY position, id`,
      [projectId],
    ),
    projectOptions(viewerId),
  ]);
  const projectRow = project.rows[0] as
    | { status_options: unknown; status: string; name: string }
    | undefined;
  const statuses = statusOptions(projectRow?.status_options);
  const sectionOptions = sections.rows.map((row) => ({
    value: Number(row.id),
    label: String(row.name),
  }));
  const fieldRows = fields.rows as { id: number; name: string; field_type: string; options: unknown; config: unknown; access_level: string; editor_ids: unknown }[];
  const customFields: CustomField[] = [];
  for (const field of fieldRows) {
    if (!isCustomFieldType(field.field_type) || isReadOnlyFieldType(field.field_type) ||
      field.field_type === "timer" || !(await canEditFieldValue(viewerId, projectId, field))) continue;
    customFields.push({
      id: Number(field.id), name: field.name, field_type: field.field_type,
      options: Array.isArray(field.options) ? field.options.map(String) : [],
      config: normalizeCustomFieldConfig(field.config),
    });
  }
  const fieldOptions = customFields.map((field) => ({
    value: Number(field.id),
    label: `${field.name} (${field.field_type})`,
  }));

  const conditionFields: ConditionFieldDescriptor[] = [
    { id: "task.name", label: "タスク名", type: "text", group: "タスク" },
    { id: "task.status", label: "Status", type: "select", group: "タスク", options: statuses },
    { id: "task.assignee_id", label: "担当者", type: "select", group: "タスク", options: users },
    { id: "task.section_id", label: "セクション", type: "select", group: "タスク", options: sectionOptions },
    {
      id: "task.completed",
      label: "完了状態",
      type: "select",
      group: "タスク",
      options: [
        { value: "true", label: "完了" },
        { value: "false", label: "未完了" },
      ],
    },
    {
      id: "task.is_milestone",
      label: "マイルストーン",
      type: "select",
      group: "タスク",
      options: [
        { value: "true", label: "マイルストーン" },
        { value: "false", label: "通常タスク" },
      ],
    },
    { id: "task.due_on", label: "期日", type: "date", group: "タスク" },
    { id: "task.start_on", label: "開始日", type: "date", group: "タスク" },
    { id: "task.progress", label: "進捗", type: "number", group: "タスク" },
    { id: "project.name", label: "プロジェクト名", type: "text", group: "プロジェクト" },
    { id: "project.status", label: "プロジェクトステータス", type: "text", group: "プロジェクト" },
    ...fieldRows.map((field) => ({
      id: `custom.${field.id}`,
      label: field.name,
      type:
        field.field_type === "number"
          ? ("number" as const)
          : field.field_type === "date"
            ? ("date" as const)
            : field.field_type === "select" || field.field_type === "multi_select"
              ? ("select" as const)
              : ("text" as const),
      group: "カスタムフィールド",
      valueType: customConditionType(field.field_type),
      options:
        field.field_type === "select" && Array.isArray(field.options)
          ? field.options.map((value) => ({ value: String(value), label: String(value) }))
          : undefined,
    })),
  ];

  const actionParams: Record<string, DescriptorParam[]> = {
    "task.assign": [
      { name: "user_id", label: "担当者", type: "select", required: true, options: users },
    ],
    "task.set_status": [
      { name: "status", label: "Status", type: "select", required: true, options: statuses },
    ],
    "task.set_due_date": [
      { name: "due_on", label: "期日", type: "date", help: "空欄の場合は今日からの日数を使います。" },
      { name: "offset_days", label: "今日からの日数", type: "number", placeholder: "3" },
    ],
    "task.move_section": [
      { name: "section_id", label: "移動先セクション", type: "select", required: true, options: sectionOptions },
    ],
    "task.complete": [],
    "task.create": [
      { name: "name", label: "タスク名", type: "text", required: true, placeholder: "例: {{event.data.title}}" },
      { name: "assignee_id", label: "担当者", type: "select", options: users },
      { name: "due_offset_days", label: "今日からの期日", type: "number", placeholder: "3" },
    ],
    "task.add_comment": [
      {
        name: "body",
        label: "コメント",
        type: "textarea",
        required: true,
        placeholder: "例: {{task.name}} が完了しました",
        help: "{{task.name}} {{task.due_on}} {{project.name}} などの変数が使えます。",
      },
    ],
    "task.create_subtask": [
      { name: "name", label: "サブタスク名", type: "text", required: true, placeholder: "例: {{task.name}} の確認" },
      { name: "assignee_id", label: "担当者", type: "select", options: users },
      { name: "due_offset_days", label: "今日からの期日", type: "number", placeholder: "3" },
    ],
    "task.set_custom_field": [
      { name: "field_id", label: "フィールド", type: "select", required: true, options: fieldOptions },
      { name: "value", label: "値", type: "text", required: true, placeholder: "値を入力" },
    ],
    "project.set_status": [
      { name: "status", label: "ステータス", type: "text", required: true, placeholder: projectRow?.status ?? "順調" },
      {
        name: "status_color",
        label: "色",
        type: "select",
        options: PROJECT_STATUS_COLORS.map((value) => ({ value, label: value })),
      },
    ],
    "task.add_to_project": [
      {
        name: "project_id",
        label: "追加先プロジェクト",
        type: "select",
        required: true,
        options: projects.filter((option) => Number(option.value) !== projectId),
      },
    ],
    "webhook.post": [
      { name: "url", label: "URL", type: "text", required: true, placeholder: "https://example.com/webhook" },
      { name: "secret", label: "署名シークレット", type: "password", placeholder: "新しいシークレット",
        help: "同じアクション・URL で変更しなければ、設定済みの値を使います。" },
    ],
  };

  const actions = ACTION_DESCRIPTORS.map((descriptor) => ({
    ...descriptor,
    params: actionParams[descriptor.id] ?? [],
  }));

  return {
    triggers: TRIGGER_DESCRIPTORS,
    conditionFields,
    operators: CONDITION_OPERATORS,
    actions,
    customFields,
    limits: RULE_LIMITS,
  };
}

/** Portfolio scope exposes only project/task fields that are safe across projects. */
export async function getPortfolioRuleDescriptors(
  portfolioId: number,
  viewerId: number,
): Promise<RuleDescriptors | null> {
  const projects = await db.query(
    `SELECT p.id, p.status_options
     FROM portfolio_items i JOIN projects p ON p.id = i.project_id
     WHERE i.portfolio_id = $1::bigint AND p.deleted_at IS NULL
       AND (EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_admin)
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2))
     ORDER BY i.added_at, p.id`,
    [portfolioId, viewerId],
  );
  if (projects.rowCount === 0) return null;
  const base = await getRuleDescriptors(Number(projects.rows[0].id), viewerId);
  const statusValues: string[] = [];
  for (const row of projects.rows as { status_options: unknown }[]) {
    if (!Array.isArray(row.status_options)) continue;
    for (const value of row.status_options) {
      const label = String(value);
      if (label !== "" && !statusValues.includes(label)) statusValues.push(label);
    }
  }
  const statusOptions = statusValues.map((value) => ({ value, label: value }));
  const conditionFields = base.conditionFields
    .filter(
      (field) =>
        field.id !== "task.section_id" && !field.id.startsWith("custom."),
    )
    .map((field) =>
      field.id === "task.status" ? { ...field, options: statusOptions } : field,
    );
  const actions = base.actions
    .filter(
      (action) =>
        action.id !== "task.move_section" && action.id !== "task.set_custom_field",
    )
    .map((action) => {
      if (action.id !== "task.set_status") return action;
      return {
        ...action,
        params: action.params.map((param) =>
          param.name === "status" ? { ...param, options: statusOptions } : param,
        ),
      };
    });
  return { ...base, conditionFields, actions };
}
