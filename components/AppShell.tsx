import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import CreateMenu from "./CreateMenu";
import OpenCommandPaletteButton from "./OpenCommandPaletteButton";
import SidebarNav from "./SidebarNav";
import SidebarRail from "./SidebarRail";
import SidebarRailFooter from "./SidebarRailFooter";
import { MOBILE_NAV, visibleNavItems } from "@/lib/navigation";
import FeedbackHost from "./ui/FeedbackHost";
import CommandPalette from "./CommandPalette";
import ResizableSidebar from "./ResizableSidebar";
import { parseSidebarWidth, SIDEBAR_WIDTH_COOKIE } from "@/lib/sidebar-width";
import { getServerSession } from "@/lib/api/session";
import { getWorkspace } from "@/lib/data";
import { canUsePortfolio } from "@/lib/repositories/portfolios";
import { hasPermission } from "@/lib/permissions";

export default async function AppShell({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme: "light" | "dark";
}) {
  const preferences = await cookies();
  const collapsed = preferences.get("atlas_sidebar")?.value === "collapsed";
  const sidebarWidth = parseSidebarWidth(preferences.get(SIDEBAR_WIDTH_COOKIE)?.value);
  const session = await getServerSession();
  const currentUserId = session?.id ?? null;
  const isAdmin = session?.isAdmin === true;
  const workspace = currentUserId === null ? undefined : await getWorkspace();
  // One server-side decision shared by every portfolio entry point.
  const showPortfolio =
    currentUserId !== null && workspace !== undefined
      ? await canUsePortfolio(workspace.id, currentUserId)
      : false;
  const showActions = currentUserId !== null;
  const canCreateProject =
    currentUserId !== null && (await hasPermission(currentUserId, "projects.create"));
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface text-text">
      <div className="flex min-h-0 flex-1">
        <ResizableSidebar collapsed={collapsed} initialWidth={sidebarWidth}>
          {collapsed ? (
            <div className="flex w-16 shrink-0 flex-col">
              <SidebarRail
                collapsed
                showPortfolio={showPortfolio}
                canCreateProject={canCreateProject}
                showActions={showActions}
              />
              <SidebarRailFooter theme={theme} />
            </div>
          ) : (
            <div id="atlas-sidebar-content" className="flex min-w-0 flex-1 flex-col">
              <Suspense fallback={<div className="p-4 text-sm text-muted">読み込み中…</div>}>
                <SidebarNav
                  theme={theme}
                  showPortfolio={showPortfolio}
                  canCreateProject={canCreateProject}
                  showActions={showActions}
                />
              </Suspense>
            </div>
          )}
        </ResizableSidebar>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b bg-surface px-2 py-1.5 text-sm md:hidden">
            <nav aria-label="モバイルナビゲーション" className="flex min-w-0 flex-1 gap-1 overflow-x-auto whitespace-nowrap">
              {visibleNavItems(MOBILE_NAV, showPortfolio).map((entry) => (
                <Link key={entry.href} href={entry.href} className="rounded px-2 py-1 hover:bg-hover">
                  {entry.label}
                </Link>
              ))}
            </nav>
            {showActions && (
              <div data-mobile-actions className="flex shrink-0 items-center gap-1">
                <CreateMenu canCreateProject={canCreateProject} variant="mobile" />
                <OpenCommandPaletteButton className="flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-[13px] text-secondary hover:bg-surface-muted hover:text-text" />
              </div>
            )}
          </div>
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
      {currentUserId !== null && <CommandPalette showPortfolio={showPortfolio} isAdmin={isAdmin} />}
      <FeedbackHost />
    </div>
  );
}
