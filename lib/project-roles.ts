export const PROJECT_ROLES = ["admin", "editor", "commenter", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  admin: "プロジェクト管理者",
  editor: "編集可能ユーザー",
  commenter: "コメント可能ユーザー",
  viewer: "閲覧可能ユーザー",
};

export const PROJECT_ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  admin: "プロジェクトの設定変更、メンバー管理、編集が可能なフルアクセス。",
  editor: "プロジェクト内のタスクを追加・編集・削除できます。",
  commenter: "プロジェクトにコメントできますが、タスクは編集できません。",
  viewer: "プロジェクトを閲覧できますが、コメントや編集はできません。",
};

/** Legacy `member` rows were used before project roles were introduced. */
export function normalizeProjectRole(role: string | null | undefined): ProjectRole | null {
  if (role === "member") return "editor";
  return PROJECT_ROLES.includes(role as ProjectRole) ? (role as ProjectRole) : null;
}

export function canManageProject(role: ProjectRole | null): boolean {
  return role === "admin";
}

export function canEditProject(role: ProjectRole | null): boolean {
  return role === "admin" || role === "editor";
}

export function canCommentOnProject(role: ProjectRole | null): boolean {
  return role === "admin" || role === "editor" || role === "commenter";
}

export function canViewProject(role: ProjectRole | null): boolean {
  return role !== null;
}
