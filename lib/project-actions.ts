import { canConfigureProject, canShareProject } from "./project-policy";
import type { ProjectRole } from "./project-roles";

export type ProjectActionKey =
  | "settings"
  | "permissions"
  | "appearance"
  | "copy-link"
  | "duplicate"
  | "template"
  | "portfolio"
  | "table"
  | "import-file"
  | "import-csv"
  | "export-csv"
  | "export-xlsx"
  | "export-json"
  | "export-timecsv"
  | "export-ical"
  | "export-print"
  | "public-link"
  | "archive"
  | "delete";

export type ProjectMenuIcon =
  | "settings"
  | "permissions"
  | "palette"
  | "link"
  | "duplicate"
  | "template"
  | "plus"
  | "table"
  | "import"
  | "export"
  | "archive"
  | "trash"
  | "csv"
  | "xlsx"
  | "json"
  | "clock"
  | "calendar"
  | "print"
  | "external";

export type ProjectMenuItem = {
  key: ProjectActionKey;
  label: string;
  icon: ProjectMenuIcon;
  roles: ProjectRole[];
  danger?: boolean;
  submenu?: { key: ProjectActionKey; label: string; icon: ProjectMenuIcon; roles?: ProjectRole[] }[];
};

export const PROJECT_MENU_GROUPS: { label: string; items: ProjectMenuItem[] }[] = [
  {
    label: "設定",
    items: [
      { key: "settings", label: "プロジェクト設定を編集", icon: "settings", roles: ["admin"] },
      { key: "permissions", label: "プロジェクト権限を管理", icon: "permissions", roles: ["admin"] },
      { key: "appearance", label: "カラーとアイコンを設定", icon: "palette", roles: ["admin"] },
    ],
  },
  {
    label: "プロジェクト",
    items: [
      { key: "copy-link", label: "プロジェクトのリンクをコピー", icon: "link", roles: ["admin", "editor", "commenter", "viewer"] },
      { key: "duplicate", label: "複製", icon: "duplicate", roles: ["admin", "editor"] },
      { key: "template", label: "テンプレートとして保存", icon: "template", roles: ["admin", "editor"] },
      { key: "portfolio", label: "ポートフォリオに追加", icon: "plus", roles: ["admin", "editor", "commenter", "viewer"] },
      { key: "table", label: "プロジェクトからテーブルを作成", icon: "table", roles: ["admin", "editor"] },
    ],
  },
  {
    label: "データ",
    items: [
      {
        key: "import-file",
        label: "インポート",
        icon: "import",
        roles: ["admin", "editor"],
        submenu: [
          { key: "import-file", label: "任意のファイル", icon: "import" },
          { key: "import-csv", label: "CSV", icon: "csv" },
        ],
      },
      {
        key: "export-csv",
        label: "エクスポートまたは同期",
        icon: "export",
        roles: ["admin", "editor", "commenter", "viewer"],
        submenu: [
          { key: "export-csv", label: "プロジェクトのタスク（CSV）", icon: "csv" },
          { key: "export-xlsx", label: "プロジェクトのタスク（XLSX）", icon: "xlsx" },
          { key: "export-timecsv", label: "時間入力（CSV）", icon: "clock" },
          { key: "export-json", label: "JSON", icon: "json" },
          { key: "export-ical", label: "iCal カレンダー", icon: "calendar" },
          { key: "export-print", label: "印刷", icon: "print" },
          { key: "public-link", label: "公開リンクを作成", icon: "external", roles: ["admin"] },
        ],
      },
      { key: "archive", label: "アーカイブ", icon: "archive", roles: ["admin"] },
      { key: "delete", label: "プロジェクトを削除", icon: "trash", roles: ["admin"], danger: true },
    ],
  },
];

export function canUseProjectAction(role: ProjectRole, item: { key: ProjectActionKey; roles: readonly ProjectRole[] }, settings?: unknown): boolean {
  if (item.key === "appearance") return canConfigureProject(role, settings);
  if (item.key === "public-link") return canShareProject(role, settings);
  return item.roles.includes(role);
}
