export type SidebarIconName =
  | "home"
  | "inbox"
  | "check"
  | "portfolio"
  | "trash"
  | "shield"
  | "search";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  icon: SidebarIconName;
  adminOnly?: boolean;
};

/** Sidebar navigation in display order (admin/trash are rendered explicitly). */
export const MAIN_NAV: NavItem[] = [
  { key: "home", href: "/", label: "ホーム", icon: "home" },
  { key: "inbox", href: "/inbox", label: "受信トレイ", icon: "inbox" },
  { key: "my-tasks", href: "/my-tasks", label: "マイタスク", icon: "check" },
  { key: "portfolio", href: "/portfolio", label: "ポートフォリオ", icon: "portfolio" },
];

export const ADMIN_NAV: NavItem = {
  key: "admin",
  href: "/admin",
  label: "管理",
  icon: "shield",
  adminOnly: true,
};

export const TRASH_NAV: NavItem = {
  key: "trash",
  href: "/trash",
  label: "削除済み",
  icon: "trash",
};

/** Compact navigation used below the md breakpoint. */
export const MOBILE_NAV: Array<{ href: string; label: string }> = [
  { href: "/", label: "ホーム" },
  { href: "/my-tasks", label: "マイタスク" },
  { href: "/inbox", label: "受信トレイ" },
  { href: "/portfolio", label: "ポートフォリオ" },
  { href: "/search", label: "検索" },
];

/** Icon rail items (collapsed sidebar). */
export const RAIL_ITEMS: Array<{ href: string; label: string; icon: SidebarIconName }> = [
  { href: "/", label: "ホーム", icon: "home" },
  { href: "/my-tasks", label: "マイタスク", icon: "check" },
  { href: "/inbox", label: "受信トレイ", icon: "inbox" },
  { href: "/search", label: "検索", icon: "search" },
  { href: "/portfolio", label: "ポートフォリオ", icon: "portfolio" },
];

export const RAIL_FLYOUTS: Record<string, { label: string; href: string }[]> = {
  "/": [
    { label: "ホーム", href: "/" },
    { label: "マイタスク", href: "/my-tasks" },
    { label: "受信トレイ", href: "/inbox" },
  ],
  "/my-tasks": [
    { label: "マイタスク", href: "/my-tasks" },
    { label: "期限超過", href: "/my-tasks#overdue" },
    { label: "今日が期日", href: "/my-tasks#today" },
    { label: "今週", href: "/my-tasks#week" },
  ],
  "/inbox": [
    { label: "受信トレイ", href: "/inbox" },
    { label: "未読を確認", href: "/inbox" },
  ],
  "/search": [
    { label: "検索", href: "/search" },
    { label: "詳細検索", href: "/search" },
  ],
  "/portfolio": [{ label: "ポートフォリオ", href: "/portfolio" }],
};

export const NAV_LABELS = {
  favorites: "お気に入り",
  recent: "最近開いた項目",
  projects: "プロジェクト",
} as const;
