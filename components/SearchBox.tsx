"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 px-4 md:block">
      <div className="pointer-events-auto relative mx-auto w-full max-w-[640px]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4 4" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
          placeholder="タスクを検索"
          className="w-full rounded-full bg-[#333333] py-1.5 pr-4 pl-9 text-sm text-white placeholder:text-neutral-400 outline-none hover:bg-[#3a3a3a] focus:bg-[#3a3a3a]"
        />
      </div>
    </div>
  );
}
