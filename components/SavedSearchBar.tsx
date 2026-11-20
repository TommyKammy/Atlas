"use client";

import { searchCriteria } from "@/lib/search-pagination";

import { confirmAction } from "@/lib/ui-feedback";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { smallSecondaryPillButtonClass } from "./ui/form-controls";

type SavedSearch = { id: number; name: string; params: Record<string, string> };

function queryFrom(params: Record<string, string>) {
  return new URLSearchParams(
    Object.entries(searchCriteria(params)).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
  ).toString();
}

export default function SavedSearchBar({
  workspaceId,
  saved,
}: {
  workspaceId: number;
  saved: SavedSearch[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const name = window.prompt("保存検索の名前");
    if (!name || name.trim() === "" || busy) return;
    setBusy(true);
    try {
      const params = searchCriteria(Object.fromEntries(new URLSearchParams(window.location.search)));
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, name: name.trim(), params }),
      });
      if (!res.ok) throw new Error(`保存に失敗しました (${res.status})`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!await confirmAction("この保存検索を削除しますか？")) return;
    const res = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  };

  return (
    <div data-saved-searches className="mt-4 flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="mr-1 font-medium text-secondary">保存検索</span>
      {saved.length === 0 && <span className="text-muted">まだありません</span>}
      {saved.map((item) => (
        <span key={item.id} className="flex h-7 items-center gap-0.5 rounded-full border border-line bg-surface pl-2.5 pr-1">
          <button
            type="button"
            data-saved-search-apply={item.id}
            onClick={() => router.push(`/search?${queryFrom(item.params)}`)}
            className="text-[12px] text-secondary hover:text-text"
          >
            {item.name}
          </button>
          <button
            type="button"
            data-saved-search-delete={item.id}
            aria-label={`${item.name}を削除`}
            onClick={() => void remove(item.id)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-subtle hover:bg-hover hover:text-danger"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        data-saved-search-save
        disabled={busy}
        onClick={() => void save()}
        className={smallSecondaryPillButtonClass}
      >
        ＋ 現在の条件を保存
      </button>
    </div>
  );
}
