export type ProjectTabViewOption = {
  value: string;
  label: string;
  description: string;
  group: "popular" | "other";
};

/** Views offered by the project tab "＋" menu, grouped like Asana. */
export const PROJECT_TAB_VIEW_OPTIONS: readonly ProjectTabViewOption[] = [
  {
    value: "list",
    label: "リスト",
    description: "表形式でタスクを整理",
    group: "popular",
  },
  {
    value: "board",
    label: "ボード",
    description: "かんばんボードで作業を確認",
    group: "popular",
  },
  {
    value: "timeline",
    label: "タイムライン",
    description: "今後の予定を立てる",
    group: "popular",
  },
  {
    value: "calendar",
    label: "カレンダー",
    description: "週単位または月単位で計画を立てる",
    group: "popular",
  },
  {
    value: "dashboard",
    label: "ダッシュボード",
    description: "プロジェクトの指標とインサイトを確認",
    group: "popular",
  },
  {
    value: "overview",
    label: "概要",
    description: "プロジェクトの全体像と最近の活動",
    group: "other",
  },
  {
    value: "messages",
    label: "メッセージ",
    description: "プロジェクトの更新を共有",
    group: "other",
  },
  {
    value: "knowledge",
    label: "知識",
    description: "ページやメモをまとめて表示",
    group: "other",
  },
  {
    value: "files",
    label: "ファイル",
    description: "添付ファイルを一覧表示",
    group: "other",
  },
  {
    value: "forms",
    label: "フォーム",
    description: "回答を受け付けるフォームを管理",
    group: "other",
  },
] as const;

export function projectTabViewLabel(value: string): string {
  return PROJECT_TAB_VIEW_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
