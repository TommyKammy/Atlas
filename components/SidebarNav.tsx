import Link from "next/link";
import { getCurrentUserId } from "@/lib/current-user";
import { getFavorites, getRecentProjects } from "@/lib/data";
import SidebarProjectLink from "./SidebarProjectLink";
import SidebarAddProject from "./SidebarAddProject";
import SidebarInviteButton from "./SidebarInviteButton";
import {
  getProjectsForUser,
  getUnreadCount,
  getUsers,
  getWorkspace,
} from "@/lib/data";

function NavIcon({ name }: { name: "home" | "inbox" | "check" | "portfolio" | "trash" | "shield" | "star" }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-4 w-4 shrink-0",
  };
  if (name === "home")
    return (
      <svg {...common}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </svg>
    );
  if (name === "inbox")
    return (
      <svg {...common}>
        <path d="M4 4h16v16H4z" />
        <path d="M4 14h4l2 3h4l2-3h4" />
      </svg>
    );
  if (name === "check")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </svg>
    );
  if (name === "portfolio")
    return (
      <svg {...common}>
        <path d="M12 3a9 9 0 1 0 9 9h-9z" />
        <path d="M12 3v9h9" />
      </svg>
    );
  if (name === "trash")
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M9 7V4h6v3" />
        <path d="M6 7l1 14h10l1-14" />
      </svg>
    );
  if (name === "shield")
    return (
      <svg {...common}>
        <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
      <path d="m12 3 2.7 5.9 6.3.7-4.7 4.3 1.3 6.3-5.6-3.2-5.6 3.2 1.3-6.3L3 9.6l6.3-.7z" />
    </svg>
  );
}

export default async function SidebarNav() {
  const cuid = await getCurrentUserId();
  const ws = await getWorkspace();
  const users = await getUsers();
  const me = users.find((u) => u.id === cuid) ?? null;
  const projects = ws && me ? await getProjectsForUser(ws.id, me.id) : [];
  const unread = ws && me ? await getUnreadCount(me.id, ws.id) : 0;
  const favorites = me ? await getFavorites(me.id) : [];
  const recents = me ? await getRecentProjects(me.id) : [];

  const item =
    "flex h-8 items-center gap-2 rounded-md px-2 text-[14px] text-neutral-300 hover:bg-white/10";
  const label = "px-2 pt-4 pb-1 text-[11px] font-medium tracking-wide text-neutral-400";
  const favoriteIds = new Set(favorites.map((f) => f.id));

  return (
    <>
      <div className="flex h-10 shrink-0 items-center px-3 text-[12px] font-medium text-neutral-400">
        <span className="truncate">{ws?.name ?? "Atlas"}</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4 text-sm">
        <Link href="/" className={item}>
          <NavIcon name="home" />
          ホーム
        </Link>
        <Link href="/inbox" className={item}>
          <NavIcon name="inbox" />
          <span className="min-w-0 flex-1 truncate">受信トレイ</span>
          {unread > 0 && (
            <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">{unread}</span>
          )}
        </Link>
        <Link href="/my-tasks" className={item}>
          <NavIcon name="check" />
          マイタスク
        </Link>
        <Link href="/portfolio" className={item}>
          <NavIcon name="portfolio" />
          ポートフォリオ
        </Link>
        {me?.is_admin && (
          <Link href="/admin" className={item}>
            <NavIcon name="shield" />
            管理
          </Link>
        )}
        {favorites.length > 0 && (
          <>
            <div className={label}>お気に入り</div>
            {favorites.map((p) => (
              <SidebarProjectLink
                key={p.id}
                project={p}
                href={`/projects/${p.id}?view=list`}
                className={`${item} text-amber-200`}
                starred
                leading="star"
              />
            ))}
          </>
        )}
        {recents.length > 0 && (
          <>
            <div className={label}>最近開いた項目</div>
            {recents.map((p) => (
              <SidebarProjectLink
                key={p.id}
                project={p}
                href={`/projects/${p.id}?view=list`}
                className={`${item} text-neutral-300`}
                starred={favoriteIds.has(p.id)}
              />
            ))}
          </>
        )}
        <Link href="/trash" className={item}>
          <NavIcon name="trash" />
          削除済み
        </Link>
        <div className={`${label} flex items-center justify-between pr-1`}>
          <span>プロジェクト</span>
          {ws && <SidebarAddProject workspaceId={ws.id} />}
        </div>
        {projects.map((p) => (
          <SidebarProjectLink
            key={p.id}
            project={p}
            href={`/projects/${p.id}?view=list`}
            className={item}
            starred={favoriteIds.has(p.id)}
          />
        ))}
        {projects.length === 0 && <div className="px-3 py-1.5 text-neutral-500">（なし）</div>}
      </nav>
      {me?.is_admin && (
        <div className="border-t border-white/10 p-2">
          <SidebarInviteButton />
        </div>
      )}
    </>
  );
}
