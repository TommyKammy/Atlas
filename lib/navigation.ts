export type SidebarIconName =
  | "home"
  | "inbox"
  | "check"
  | "portfolio"
  | "trash"
  | "shield"
  | "search";

type NavVisibility = {
  /** Entry is only shown to users who can use portfolios. */
  portfolioOnly?: boolean;
};

export type NavItem = NavVisibility & {
  key: string;
  href: string;
  label: string;
  icon: SidebarIconName;
  adminOnly?: boolean;
};

export type CompactNavItem = NavVisibility & { href: string; label: string };

export type RailItem = NavVisibility & {
  href: string;
  label: string;
  icon: SidebarIconName;
};

export type RailFlyoutLink = NavVisibility & { label: string; href: string };

/** Drop entries the viewer must not see without matching on labels or hrefs. */
export function visibleNavItems<T extends NavVisibility>(items: T[], showPortfolio: boolean): T[] {
  return showPortfolio ? items : items.filter((item) => !item.portfolioOnly);
}

/** Sidebar navigation in display order (admin/trash are rendered explicitly). */
export const MAIN_NAV: NavItem[] = [
  { key: "home", href: "/", label: "ホーム", icon: "home" },
  { key: "inbox", href: "/inbox", label: "受信トレイ", icon: "inbox" },
  { key: "my-tasks", href: "/my-tasks", label: "マイタスク", icon: "check" },
  { key: "portfolio", href: "/portfolio", label: "ポートフォリオ", icon: "portfolio", portfolioOnly: true },
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
export const MOBILE_NAV: CompactNavItem[] = [
  { href: "/", label: "ホーム" },
  { href: "/my-tasks", label: "マイタスク" },
  { href: "/inbox", label: "受信トレイ" },
  { href: "/portfolio", label: "ポートフォリオ", portfolioOnly: true },
];

/** Icon rail items (collapsed sidebar). */
export const RAIL_ITEMS: RailItem[] = [
  { href: "/", label: "ホーム", icon: "home" },
  { href: "/my-tasks", label: "マイタスク", icon: "check" },
  { href: "/inbox", label: "受信トレイ", icon: "inbox" },
  { href: "/portfolio", label: "ポートフォリオ", icon: "portfolio", portfolioOnly: true },
];

export const RAIL_FLYOUTS: Record<string, RailFlyoutLink[]> = {
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
  "/portfolio": [{ label: "ポートフォリオ", href: "/portfolio", portfolioOnly: true }],
};

export const NAV_LABELS = {
  favorites: "お気に入り",
  recent: "最近開いた項目",
  projects: "プロジェクト",
} as const;
