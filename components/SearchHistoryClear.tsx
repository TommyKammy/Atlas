"use client";

import { useRouter } from "next/navigation";

export default function SearchHistoryClear() {
  const router = useRouter();
  return (
    <button
      type="button"
      data-search-history-clear
      onClick={async () => {
        await fetch("/api/search/history", { method: "DELETE" }).catch(() => undefined);
        router.refresh();
      }}
      className="inline-flex h-7 items-center rounded-md px-2 text-[12px] text-muted hover:bg-hover hover:text-text"
    >
      履歴をクリア
    </button>
  );
}
