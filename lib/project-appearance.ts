// Shared project appearance tokens for the sidebar context menu and header.

export const PROJECT_COLORS = [
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

export const DEFAULT_PROJECT_COLORS = ["#f06a6a", "#f1bd6c", "#aecf55", "#5da283", "#4573d2", "#8d84e8", "#ec8d71"];

export function projectColor(id: number, color?: string | null) {
  return color ?? DEFAULT_PROJECT_COLORS[id % DEFAULT_PROJECT_COLORS.length];
}
