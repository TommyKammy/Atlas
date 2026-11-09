import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import HeaderAuth from "./HeaderAuth";
import SidebarNav from "./SidebarNav";
import SidebarRail from "./SidebarRail";
import SidebarRailFooter from "./SidebarRailFooter";
import SidebarToggle from "./SidebarToggle";
import ThemeToggle from "./ThemeToggle";
import { MOBILE_NAV } from "@/lib/navigation";
import FeedbackHost from "./ui/FeedbackHost";

export default async function AppShell({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme: "light" | "dark";
}) {
  const collapsed = (await cookies()).get("atlas_sidebar")?.value === "collapsed";
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white text-neutral-900">
      <header className="relative z-40 flex h-12 shrink-0 items-center gap-3 bg-[#262626] px-3 text-neutral-200">
        <SidebarToggle initialCollapsed={collapsed} />
        <Suspense fallback={<span className="text-sm font-semibold text-white">Atlas</span>}>
          <HeaderAuth />
        </Suspense>
        <div className="ml-auto flex items-center">
          <ThemeToggle initialTheme={theme} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          className={`relative z-30 hidden shrink-0 bg-[#262626] text-neutral-200 transition-[width] duration-150 md:flex ${
            collapsed ? "w-16" : "w-[244px]"
          }`}
        >
          <div className="flex w-16 shrink-0 flex-col border-r border-white/10">
            <SidebarRail collapsed={collapsed} />
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
            {MOBILE_NAV.map((entry) => (
              <Link key={entry.href} href={entry.href} className="rounded px-2 py-1 hover:bg-neutral-100">
                {entry.label}
              </Link>
            ))}
          </nav>
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
      <FeedbackHost />
    </div>
  );
}
