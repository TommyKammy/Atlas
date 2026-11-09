import { db } from "../db";
import { PROJECT_STATUS_COLORS } from "../project-status";
import { CONDITION_OPERATORS, RULE_LIMITS } from "./types";

export type DescriptorOption = { value: string | number; label: string };

export type DescriptorParam = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "boolean";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: DescriptorOption[];
};

export type TriggerDescriptor = {
  id: string;
  label: string;
  description: string;
  subject: "task" | "project" | "comment" | "form";
  days?: { label: string; default: number; help?: string };
};

export type ConditionFieldDescriptor = {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "boolean";
  group: string;
  options?: DescriptorOption[];
};

export type ActionDescriptor = {
  id: string;
  label: string;
  description: string;
  params: DescriptorParam[];
};

export type RuleDescriptors = {
  triggers: TriggerDescriptor[];
  conditionFields: ConditionFieldDescriptor[];
  operators: typeof CONDITION_OPERATORS;
  actions: ActionDescriptor[];
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
  { id: "task.added_to_project", label: "プロジェクトに追加されたとき", description: "マルチホームなどでプロジェクトに追加されたときに実行", subject: "task" },
  { id: "comment.created", label: "コメントが追加されたとき", description: "タスクにコメントが投稿されたときに実行", subject: "task" },
  { id: "form.submitted", label: "フォームが送信されたとき", description: "プロジェクトのフォームからタスクが作成されたときに実行", subject: "task" },
  { id: "project.status_changed", label: "プロジェクトステータスが変更されたとき", description: "プロジェクトのステータス更新が投稿されたときに実行", subject: "project" },
  {
    id: "task.due_soon",
    label: "期日が近づいたとき",
    description: "期日まで指定日数以内になった未完了タスクに対して実行",
    subject: "task",
    days: { label: "何日前に実行", default: 1, help: "0を指定すると期日当日に実行します。" },
  },
  {
    id: "task.overdue",
    label: "期日を過ぎたとき",
    description: "期日を指定日数過ぎた未完了タスクに対して実行",
    subject: "task",
    days: { label: "何日過ぎたら実行", default: 0 },
  },
  { id: "task.manual_rule", label: "手動で実行", description: "ルール画面から手動実行したときに実行", subject: "task" },
];

export const ACTION_DESCRIPTORS: Omit<ActionDescriptor, "params">[] = [
  { id: "task.assign", label: "担当者を変更", description: "タスクの担当者を設定・変更します。" },
  { id: "task.set_status", label: "Statusを変更", description: "タスクのStatusを変更します。" },
  { id: "task.set_due_date", label: "期日を変更", description: "期日を指定日付、または今日からの日数で設定します。" },
  { id: "task.move_section", label: "セクションを移動", description: "タスクを指定セクションに移動します。" },
  { id: "task.complete", label: "タスクを完了", description: "タスクを完了状態にします。" },
  { id: "task.add_comment", label: "コメントを追加", description: "タスクにコメントを投稿します。変数が使えます。" },
  { id: "task.create_subtask", label: "サブタスクを作成", description: "対象タスクの下にサブタスクを作成します。" },
  { id: "task.set_custom_field", label: "カスタムフィールドを設定", description: "指定フィールドに値を設定します。" },
  { id: "project.set_status", label: "プロジェクトステータスを更新", description: "プロジェクトの現在ステータスを更新します。" },
  { id: "task.add_to_project", label: "別プロジェクトに追加", description: "タスクを別プロジェクトにマルチホームします。" },
  { id: "webhook.post", label: "Webhookを送信", description: "外部URLへJSONをPOSTします。" },
];

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
): Promise<RuleDescriptors> {
  const [project, users, sections, fields, projects] = await Promise.all([
    db.query(
      `SELECT id, name, status, status_color, status_options, owner_id
       FROM projects WHERE id = $1::bigint`,
      [projectId],
    ),
    userOptions(),
    db.query("SELECT id, name FROM sections WHERE project_id = $1 ORDER BY position, id", [projectId]),
    db.query(
      `SELECT id, name, field_type, options FROM custom_fields
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
  const fieldRows = fields.rows as { id: number; name: string; field_type: string; options: unknown }[];
  const fieldOptions = fieldRows.map((field) => ({
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
      { name: "secret", label: "署名シークレット", type: "text", placeholder: "任意" },
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
    limits: RULE_LIMITS,
  };
}
