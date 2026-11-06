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
      className="text-[11px] text-neutral-500 hover:underline"
    >
      履歴をクリア
    </button>
  );
}
