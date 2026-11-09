"use client";

import EmptyState from "../EmptyState";

/** Empty-state card shown when a project has no tasks. */
export default function ListEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      scope="list"
      title="タスクがありません"
      description="最初のタスクを追加して、このプロジェクトを進めましょう。"
      action={
        <button
          type="button"
          onClick={onAdd}
          className="h-8 rounded-md bg-[#2c60b8] px-4 text-[13px] font-medium text-white hover:bg-[#24529c]"
        >
          ＋ タスクを追加
        </button>
      }
    />
  );
}
