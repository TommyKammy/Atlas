"use client";

import EmptyState from "../EmptyState";

/** Distinguish an empty project from an empty dashboard selection. */
export default function ListEmptyState({ onAdd, mode = "project" }: { onAdd: () => void; mode?: "project" | "filtered" }) {
  if (mode === "filtered") {
    return <EmptyState
      scope="list"
      title="条件に一致するタスクがありません"
      description="ダッシュボードの条件や追加のフィルターを変更してください。"
    />;
  }
  return (
    <EmptyState
      scope="list"
      title="タスクがありません"
      description="最初のタスクを追加して、このプロジェクトを進めましょう。"
      action={
        <button
          type="button"
          onClick={onAdd}
          className="h-8 rounded-md bg-accent px-4 text-[13px] font-medium text-white hover:bg-[#24529c]"
        >
          ＋ タスクを追加
        </button>
      }
    />
  );
}
