import type { TaskRow } from "./data";

export const HOME_WIDGET_TYPES = ["my_tasks", "projects", "assigned_tasks", "members"] as const;
export type HomeWidgetType = (typeof HOME_WIDGET_TYPES)[number];
export type HomeWidgetSize = "half" | "full";

export type HomeWidget = {
  id: number;
  workspace_id: number;
  user_id: number;
  widget_type: HomeWidgetType;
  size: HomeWidgetSize;
  position: number;
  config: Record<string, unknown>;
};

export const HOME_WIDGET_META: Record<
  HomeWidgetType,
  { label: string; description: string; defaultSize: HomeWidgetSize }
> = {
  my_tasks: {
    label: "マイタスク",
    description: "自分に割り当てられたタスクを、今後・期限超過・完了で確認",
    defaultSize: "half",
  },
  projects: {
    label: "プロジェクト",
    description: "最近開いたプロジェクトと、まもなく期限のタスク",
    defaultSize: "half",
  },
  assigned_tasks: {
    label: "自分が割り当てたタスク",
    description: "自分が他のメンバーに割り当てたタスク",
    defaultSize: "half",
  },
  members: {
    label: "メンバー",
    description: "よく一緒に作業するメンバーと担当タスク",
    defaultSize: "half",
  },
};

export const DEFAULT_HOME_WIDGETS: { widget_type: HomeWidgetType; size: HomeWidgetSize }[] = [
  { widget_type: "my_tasks", size: "half" },
  { widget_type: "projects", size: "half" },
  { widget_type: "assigned_tasks", size: "half" },
  { widget_type: "members", size: "half" },
];

export function isHomeWidgetType(value: unknown): value is HomeWidgetType {
  return typeof value === "string" && (HOME_WIDGET_TYPES as readonly string[]).includes(value);
}

export function isHomeWidgetSize(value: unknown): value is HomeWidgetSize {
  return value === "half" || value === "full";
}

export type HomeTask = TaskRow & { project_name: string | null };
export type HomeProject = {
  id: number;
  name: string;
  color: string | null;
  icon: string | null;
  due_soon: number;
  open_count: number;
  last_opened: string | null;
};
export type HomeMember = {
  id: number;
  name: string;
  title: string | null;
  avatar_url: string | null;
  shared_projects: number;
  open_tasks: number;
  week_tasks: number;
  month_tasks: number;
};
