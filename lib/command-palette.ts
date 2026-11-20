import { ADMIN_NAV, MAIN_NAV, TRASH_NAV, visibleNavItems } from "./navigation";
import {
  historyHref,
  type SearchSuggestOption,
} from "./search-types";

export type PaletteItem = {
  key: string;
  label: string;
  sublabel?: string;
  href: string;
  keywords?: string[];
};

export type PaletteSection = {
  key: string;
  label: string;
  items: PaletteItem[];
};

const SEARCH_GROUP_ORDER: Exclude<SearchSuggestOption["group"], "history">[] = [
  "tasks",
  "projects",
  "messages",
  "knowledge",
  "files",
];

const SEARCH_GROUP_LABELS: Record<Exclude<SearchSuggestOption["group"], "history">, string> = {
  tasks: "タスク",
  projects: "プロジェクト",
  messages: "メッセージ",
  knowledge: "知識",
  files: "ファイル",
};

/**
 * Reading aids for navigation labels. They are matched, not displayed, so a
 * Japanese reading such as "じぶん" can still find マイタスク.
 */
const NAV_KEYWORDS: Record<string, string[]> = {
  home: ["ホーム", "home"],
  inbox: ["受信トレイ", "inbox", "お知らせ"],
  "my-tasks": ["マイタスク", "自分のタスク", "じぶん", "my tasks"],
  portfolio: ["ポートフォリオ", "portfolio"],
  admin: ["管理", "管理者", "admin"],
  trash: ["削除済み", "ゴミ箱", "trash"],
};

/**
 * Fold the differences Japanese and Latin input commonly produce: full-width
 * forms, letter case, katakana vs hiragana, and spacing.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "");
}

function matches(value: string, query: string): boolean {
  return normalizeForSearch(value).includes(normalizeForSearch(query));
}

/** Keep items whose label, sublabel, or reading aid contains the query. */
export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const normalized = normalizeForSearch(query);
  if (normalized === "") return items;
  return items.filter((item) =>
    [item.label, item.sublabel ?? "", ...(item.keywords ?? [])].some((value) =>
      matches(value, query),
    ),
  );
}

/** Navigation commands, already filtered by portfolio and administrator access. */
export function buildNavigationItems(
  showPortfolio: boolean,
  isAdmin: boolean,
): PaletteItem[] {
  const items = [...visibleNavItems(MAIN_NAV, showPortfolio)];
  if (isAdmin) items.push(ADMIN_NAV);
  items.push(TRASH_NAV);
  return items.map((item) => ({
    key: `nav-${item.key}`,
    label: item.label,
    href: item.href,
    keywords: NAV_KEYWORDS[item.key] ?? [],
  }));
}

/**
 * Build the visible sections in keyboard order: matched navigation first,
 * grouped search hits next, and the "search everything" command last.
 */
export function buildPaletteSections({
  query,
  showPortfolio,
  isAdmin,
  searchOptions,
}: {
  query: string;
  showPortfolio: boolean;
  isAdmin: boolean;
  searchOptions: SearchSuggestOption[];
}): PaletteSection[] {
  const trimmed = query.trim();
  const sections: PaletteSection[] = [];

  const navigation = filterPaletteItems(
    buildNavigationItems(showPortfolio, isAdmin),
    trimmed,
  );
  if (navigation.length > 0) {
    sections.push({ key: "navigation", label: "移動", items: navigation });
  }

  if (trimmed === "") return sections;

  for (const group of SEARCH_GROUP_ORDER) {
    const items = searchOptions
      .filter((option) => option.group === group)
      .map((option) => ({
        key: `search-${option.key}`,
        label: option.label,
        sublabel: option.sublabel,
        href: option.href,
      }));
    if (items.length > 0) {
      sections.push({ key: `search-${group}`, label: SEARCH_GROUP_LABELS[group], items });
    }
  }

  sections.push({
    key: "search-all",
    label: "検索",
    items: [
      {
        key: "search-all",
        label: `「${trimmed}」をすべての結果で検索`,
        href: historyHref(trimmed),
      },
    ],
  });
  return sections;
}

export function flattenPaletteSections(sections: PaletteSection[]): PaletteItem[] {
  return sections.flatMap((section) => section.items);
}

/** True when there is a navigation command or a real search hit. */
export function hasPaletteResults(sections: PaletteSection[]): boolean {
  return sections.some(
    (section) => section.key !== "search-all" && section.items.length > 0,
  );
}

export function movePaletteIndex(current: number, length: number, delta: 1 | -1): number {
  if (length === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}

export function paletteOptionId(index: number): string {
  return `command-palette-option-${index}`;
}
