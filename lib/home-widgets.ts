import type { TaskRow } from "./data";

export const HOME_WIDGET_TYPES = [
  "my_tasks",
  "projects",
  "assigned_tasks",
  "members",
  "portfolio",
  "status_updates",
  "forms",
  "mentions",
  "comment_drafts",
  "notepad",
] as const;
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
  portfolio: {
    label: "ポートフォリオ",
    description: "プロジェクトの進捗・期限超過・メンバー数をまとめて確認",
    defaultSize: "half",
  },
  status_updates: {
    label: "ステータス更新",
    description: "プロジェクトの最新ステータスを投稿・確認",
    defaultSize: "half",
  },
  forms: {
    label: "フォーム",
    description: "公開中のフォームと回答数をプロジェクト横断で確認",
    defaultSize: "half",
  },
  mentions: {
    label: "メンション",
    description: "自分宛ての @メンションを新しい順に確認",
    defaultSize: "half",
  },
  comment_drafts: {
    label: "コメント下書き",
    description: "書きかけのコメントをタスクごとに再開",
    defaultSize: "half",
  },
  notepad: {
    label: "非公開メモ帳",
    description: "自分だけが見られるメモをホームに保存",
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

export type HomePortfolioProject = {
  id: number;
  name: string;
  color: string | null;
  icon: string | null;
  total: number;
  done: number;
  overdue: number;
  members: number;
  min_due: string | null;
  max_due: string | null;
  saved: boolean;
};

export type HomeStatusUpdate = {
  id: number;
  project_id: number;
  project_name: string;
  project_color: string | null;
  project_icon: string | null;
  author_id: number | null;
  author_name: string | null;
  author_avatar_url: string | null;
  body: string;
  status: string | null;
  status_color: string;
  created_at: string;
};

export type HomeStatusProject = {
  id: number;
  name: string;
  color: string | null;
  icon: string | null;
  status: string | null;
  status_color: string | null;
};

export type HomeForm = {
  id: number;
  project_id: number;
  project_name: string;
  project_color: string | null;
  project_icon: string | null;
  name: string;
  description: string;
  published: boolean;
  response_count: number;
  updated_at: string;
};

export type HomeMention = {
  comment_id: number;
  body: string;
  created_at: string;
  author_id: number | null;
  author_name: string | null;
  author_avatar_url: string | null;
  task_id: number;
  task_name: string;
  project_id: number;
  project_name: string;
  is_read: boolean;
};

export type HomeCommentDraft = {
  task_id: number;
  task_name: string;
  project_id: number;
  project_name: string;
  body: string;
  updated_at: string;
};

export type HomeNotepad = {
  body: string;
  updated_at: string | null;
};
