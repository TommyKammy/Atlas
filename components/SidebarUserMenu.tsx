"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import UserAvatar from "./UserAvatar";
import InviteUserDialog from "./InviteUserDialog";

type MenuUser = {
  id: number;
  name: string;
  email: string | null;
  title: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  is_admin: boolean;
};

export default function SidebarUserMenu({ user }: { user: MenuUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ left: rect.right + 8, bottom: window.innerHeight - rect.bottom });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const item = "flex h-9 items-center gap-2 rounded px-3 text-[13px] text-neutral-800 hover:bg-neutral-100";

  return (
    <>
      <button
        ref={ref}
        type="button"
        data-sidebar-user-menu
        onClick={openMenu}
        aria-label="ユーザー設定"
        title="ユーザー設定"
        className="flex h-7 w-7 items-center justify-center rounded-full hover:ring-2 hover:ring-white/20"
      >
        <UserAvatar name={user.name} url={user.avatar_url} className="h-7 w-7" />
      </button>

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="menu"
            className="fixed z-[130] w-60 rounded-lg border border-neutral-200 bg-white py-1 text-neutral-900 shadow-xl"
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2.5">
              <UserAvatar name={user.name} url={user.avatar_url} className="h-10 w-10" textClassName="text-sm" />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="truncate text-sm font-semibold">{user.name}</span>
                  {user.is_guest && (
                    <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">ゲスト</span>
                  )}
                </div>
                <div className="truncate text-[11px] text-neutral-500">{user.email ?? ""}</div>
                {user.title && <div className="truncate text-[11px] text-neutral-500">{user.title}</div>}
              </div>
            </div>
            {user.is_admin && (
              <>
                <Link href="/admin" onClick={() => setOpen(false)} className={`${item} mt-1`}>
                  管理者コンソール
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setInviteOpen(true);
                  }}
                  className={item}
                >
                  メンバーを招待
                </button>
                <div className="my-1 border-t border-neutral-100" />
              </>
            )}
            <Link href="/profile" onClick={() => setOpen(false)} className={item}>
              プロフィール
            </Link>
            <Link href="/profile" onClick={() => setOpen(false)} className={item}>
              設定
            </Link>
            <div className="my-1 border-t border-neutral-100" />
            <button type="button" onClick={logout} className={item}>
              ログアウト
            </button>
          </div>,
          document.body,
        )}

      <InviteUserDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}
