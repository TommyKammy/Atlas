"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SidebarToggle({ initialCollapsed }: { initialCollapsed: boolean }) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `atlas_sidebar=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <button
      type="button"
      data-sidebar-toggle
      onClick={toggle}
      aria-label={collapsed ? "サイドバーを展開" : "サイドバーを非表示にする"}
      title={collapsed ? "サイドバーを展開" : "サイドバーを非表示にする"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-text-strong"
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
