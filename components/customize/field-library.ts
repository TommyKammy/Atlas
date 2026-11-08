import type { CustomField } from "@/lib/custom-fields";

export const FIELD_TYPE_LABELS: Record<CustomField["field_type"], string> = {
  text: "テキスト",
  number: "数値",
  select: "単一選択",
  multi_select: "複数選択",
  date: "日付",
  people: "メンバー",
  auto_id: "ID",
  project: "プロジェクト",
  completed_on: "完了日",
  created_at: "作成日",
  modified_at: "最終変更日",
  created_by: "作成したユーザー",
  collaborators: "コラボレーター",
  attachments: "添付",
  blocked_by: "先行タスク",
  blocking: "後続を待たせている",
  formula: "数式",
  reference: "リファレンス",
  lookup: "ルックアップ",
  rollup: "集計",
  timer: "タイマー",
  time_tracking: "タイムトラッキング",
};

export const FIELD_TYPE_ICONS: Record<CustomField["field_type"], string> = {
  text: "T",
  number: "123",
  select: "○",
  multi_select: "☑",
  date: "📅",
  people: "👤",
  auto_id: "ID",
  project: "▤",
  completed_on: "✓",
  created_at: "＋",
  modified_at: "↻",
  created_by: "✎",
  collaborators: "👥",
  attachments: "📎",
  blocked_by: "←",
  blocking: "→",
  formula: "ƒ",
  reference: "🔗",
  lookup: "⇢",
  rollup: "Σ",
  timer: "⏱",
  time_tracking: "◷",
};

export const FIELD_LIBRARY: Array<{
  name: string;
  description: string;
  field_type: CustomField["field_type"];
  options: string[];
}> = [
  { name: "優先度", description: "高 / 中 / 低", field_type: "select", options: ["高", "中", "低"] },
  { name: "承認状況", description: "承認待ち / 承認済み / 差し戻し", field_type: "select", options: ["承認待ち", "承認済み", "差し戻し"] },
  { name: "作業量", description: "数値で見積もりを入力", field_type: "number", options: [] },
  { name: "見積時間", description: "時間単位の数値", field_type: "number", options: [] },
  { name: "メモ", description: "補足情報を自由記述", field_type: "text", options: [] },
  { name: "部署", description: "担当部署をテキストで入力", field_type: "text", options: [] },
];
