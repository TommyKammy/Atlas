import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import HeaderAuth from "./HeaderAuth";
import SidebarNav from "./SidebarNav";
import SidebarRail from "./SidebarRail";
import SidebarRailFooter from "./SidebarRailFooter";
import SidebarToggle from "./SidebarToggle";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = (await cookies()).get("atlas_sidebar")?.value === "collapsed";
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white text-neutral-900">
      <header className="relative z-20 flex h-12 shrink-0 items-center gap-3 bg-[#262626] px-3 text-neutral-200">
        <SidebarToggle initialCollapsed={collapsed} />
        <Suspense fallback={<span className="text-sm font-semibold text-white">Atlas</span>}>
          <HeaderAuth />
        </Suspense>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          className={`hidden shrink-0 bg-[#262626] text-neutral-200 transition-[width] duration-150 md:flex ${
            collapsed ? "w-16" : "w-[244px]"
          }`}
        >
          <div className="flex w-16 shrink-0 flex-col border-r border-white/10">
            <SidebarRail />
            <SidebarRailFooter />
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-1 flex-col">
              <Suspense fallback={<div className="p-4 text-sm text-neutral-500">読み込み中…</div>}>
                <SidebarNav />
              </Suspense>
            </div>
          )}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex gap-1 overflow-x-auto border-b bg-white px-2 py-1.5 text-sm whitespace-nowrap md:hidden">
            <Link href="/" className="rounded px-2 py-1 hover:bg-neutral-100">ホーム</Link>
            <Link href="/my-tasks" className="rounded px-2 py-1 hover:bg-neutral-100">マイタスク</Link>
            <Link href="/inbox" className="rounded px-2 py-1 hover:bg-neutral-100">受信トレイ</Link>
            <Link href="/portfolio" className="rounded px-2 py-1 hover:bg-neutral-100">ポートフォリオ</Link>
            <Link href="/search" className="rounded px-2 py-1 hover:bg-neutral-100">検索</Link>
          </nav>
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}
