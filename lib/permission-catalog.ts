export const PERMISSION_CATALOG = [
  {
    key: "members.manage",
    label: "メンバー管理",
    group: "管理",
    description: "ユーザーの作成・編集・無効化・招待",
  },
  {
    key: "teams.manage",
    label: "チーム管理",
    group: "管理",
    description: "チームの作成・編集・メンバー管理",
  },
  {
    key: "workspace.manage",
    label: "組織設定",
    group: "管理",
    description: "組織名などのワークスペース設定",
  },
  {
    key: "security.manage",
    label: "セキュリティ管理",
    group: "セキュリティ",
    description: "2FA・SAML・パスワードポリシーの設定",
  },
  {
    key: "roles.manage",
    label: "役割管理",
    group: "セキュリティ",
    description: "RBAC の役割と権限の作成・編集",
  },
  {
    key: "insights.view",
    label: "利用状況の閲覧",
    group: "インサイト",
    description: "利用統計と管理ダッシュボードの閲覧",
  },
  {
    key: "audit.view",
    label: "監査ログの閲覧",
    group: "インサイト",
    description: "監査ログの表示とエクスポート",
  },
  {
    key: "projects.create",
    label: "プロジェクト作成",
    group: "ワークスペース",
    description: "新しいプロジェクトの作成",
  },
  {
    key: "tasks.create",
    label: "タスク作成",
    group: "ワークスペース",
    description: "タスクの作成と更新",
  },
] as const;

export type Permission = (typeof PERMISSION_CATALOG)[number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_CATALOG.map((entry) => entry.key);

export const ADMIN_CONSOLE_PERMISSIONS: Permission[] = [
  "members.manage",
  "teams.manage",
  "workspace.manage",
  "security.manage",
  "roles.manage",
  "insights.view",
  "audit.view",
];

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (ALL_PERMISSIONS as string[]).includes(value);
}

export function normalizePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isPermission))];
}
