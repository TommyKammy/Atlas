// Data colors are information, not theme semantics.
//
// Series, progress bars, status dots, avatars and user-chosen project colors
// identify data or a user's own choice. They must keep the same value when the
// light/dark palette changes, so they are intentionally not `--atlas-*` theme
// tokens. This module is the single source for those literals; components
// import from here instead of writing color classes inline.
//
// scripts/check-color-literals.mjs excludes this file by path. See
// docs/design-tokens.md "データの色".

/** Dashboard chart series. Index order is the series identity. */
export const CHART_SERIES_COLORS = ["#9b8cff", "#37b97c", "#5b9cf8", "#f0a44b", "#e879a8"];

/** Dashboard benchmark line. */
export const CHART_BENCHMARK_COLOR = "#e879a8";

/** Completed-donut arc used by the stats panel. */
export const CHART_COMPLETION_COLOR = "#16a34a";

/** Bar colors used by the usage widgets and the project progress bars. */
export const PROGRESS_BAR_COLORS = {
  created: "bg-blue-500",
  completed: "bg-green-500",
  comments: "bg-amber-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
} as const;

/** Project status dots. The key matches the stored status_color value. */
export const PROJECT_STATUS_DOT_CLASSES = {
  green: "bg-green-600",
  yellow: "bg-amber-500",
  red: "bg-red-600",
  blue: "bg-blue-600",
  muted: "bg-neutral-400",
} as const;

/** Avatar chips. The first character of the name selects one. */
export const AVATAR_COLORS = ["bg-violet-400", "bg-amber-400", "bg-emerald-500", "bg-sky-500", "bg-rose-400"];

/** Comment author avatar chip. */
export const COMMENT_AVATAR_CLASS = "bg-[#d8e3f3] text-[#38506e]";

/** Fallback avatar for a message author without a stored avatar. */
export const AVATAR_FALLBACK_CLASS = "bg-neutral-500";

/** Calendar category bars (border / surface / text). */
export const CALENDAR_BAR_COLORS = [
  "border-[#c7d8f5] bg-[#e8f0fe] text-[#1f3a6e]",
  "border-[#c9e7d2] bg-[#e6f6ec] text-[#1f5134]",
  "border-[#f3d9b1] bg-[#fdf2e2] text-[#6b4a1d]",
  "border-[#e6cdea] bg-[#f6e8f8] text-[#5b2a63]",
  "border-[#f1c9c9] bg-[#fdecec] text-[#6b2727]",
  "border-[#c9e3e7] bg-[#e8f6f8] text-[#1f4e56]",
];

/** Timeline bars whose fill encodes completion or critical path state. */
export const TIMELINE_COMPLETED_BAR = "bg-[#aaaaaa]";
export const TIMELINE_CRITICAL_BAR = "bg-red-200";
export const TIMELINE_CRITICAL_LINE = "bg-[#46a75a]";

/** Milestone marker colors. */
export const MILESTONE_ICON_COLOR = "text-[#46a75a]";
export const MILESTONE_CRITICAL_BACKGROUND = "bg-red-100";
export const MILESTONE_CRITICAL_RING = "ring-red-400";

/** Capacity comparison bars: shortage is warm, remaining capacity is blue. */
export const CAPACITY_BAR_COLORS = {
  shortage: "bg-[#c2602f]",
  available: "bg-[#7f9dcc]",
} as const;

/** Draft status dot in the status-field settings. */
export const STATUS_DRAFT_DOT = "bg-[#8db8ff]";

/** User-selectable project colors. */
export const PROJECT_COLOR_OPTIONS = [
  { name: "なし", value: null },
  { name: "赤", value: "#ff8576" },
  { name: "オレンジ", value: "#ff9f4b" },
  { name: "橙黄", value: "#f7bd51" },
  { name: "黄色", value: "#ffd721" },
  { name: "黄緑", value: "#c3e684" },
  { name: "緑", value: "#82d990" },
  { name: "青緑", value: "#6ad8bc" },
  { name: "アクア", value: "#83ebd1" },
  { name: "青", value: "#8db8ff" },
  { name: "インディゴ", value: "#b8acff" },
  { name: "紫", value: "#e39ef2" },
  { name: "マゼンタ", value: "#ffbeff" },
  { name: "ホットピンク", value: "#fc96bf" },
  { name: "ピンク", value: "#ffc6bd" },
  { name: "クールグレー", value: "#aaaaaa" },
] as const;

/** Colors used when a project has no explicit color. */
export const DEFAULT_PROJECT_COLORS = ["#f06a6a", "#f1bd6c", "#aecf55", "#5da283", "#4573d2", "#8d84e8", "#ec8d71"];

/** Neutral swatch shown when a project color is missing from a saved value. */
export const PROJECT_COLOR_FALLBACK = "#d9d9d9";

/** Initial tile background when a project has no color. */
export const PROJECT_INITIAL_BACKGROUND = "#f1bd6c";

/** Text drawn on a project color tile (readable over the palette). */
export const PROJECT_INITIAL_TEXT = "#171717";

/** Text colors returned by `readableTextColor`. */
export const DATA_TEXT_DARK = "#171717";
export const DATA_TEXT_LIGHT = "#ffffff";

/** Default template colors, kept stable across themes. */
export const TEMPLATE_COLORS = {
  blue: "#4573d2",
  teal: "#5da283",
  coral: "#f06a6a",
  violet: "#8d84e8",
  amber: "#f7bd51",
  peach: "#f1bd6c",
  terracotta: "#ec8d71",
  aqua: "#6ad8bc",
  gray: "#aaaaaa",
  green: "#82d990",
  sky: "#8db8ff",
  orchid: "#e39ef2",
} as const;
