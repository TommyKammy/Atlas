// Shared project appearance tokens for the sidebar context menu and header.
import {
  DATA_TEXT_DARK,
  DATA_TEXT_LIGHT,
  DEFAULT_PROJECT_COLORS as DATA_DEFAULT_PROJECT_COLORS,
  PROJECT_COLOR_OPTIONS,
} from "./data-colors";

export const PROJECT_COLORS = PROJECT_COLOR_OPTIONS;

export const PROJECT_ICONS = [
  { key: null, label: "なし" },
  { key: "list", label: "リスト" },
  { key: "board", label: "ボード" },
  { key: "target", label: "目標" },
  { key: "briefcase", label: "仕事" },
  { key: "heart", label: "ハート" },
  { key: "star", label: "スター" },
  { key: "rocket", label: "ロケット" },
] as const;

export type ProjectIconKey = Exclude<(typeof PROJECT_ICONS)[number]["key"], null>;

export const DEFAULT_PROJECT_COLORS = DATA_DEFAULT_PROJECT_COLORS;

export function projectColor(id: number, color?: string | null) {
  return color ?? DEFAULT_PROJECT_COLORS[id % DEFAULT_PROJECT_COLORS.length];
}

/** Pick dark or light text for a hex background using WCAG relative luminance. */
export function readableTextColor(background: string): string {
  const hex = background.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return DATA_TEXT_LIGHT;
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(hex.slice(0, 2), 16));
  const g = channel(parseInt(hex.slice(2, 4), 16));
  const b = channel(parseInt(hex.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? DATA_TEXT_DARK : DATA_TEXT_LIGHT;
}
