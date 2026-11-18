"use client";

import { toast as toastMessage } from "@/lib/ui-feedback";

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
  out_of_office_from?: string | null;
  out_of_office_to?: string | null;
  out_of_office_note?: string | null;
};

function MenuIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-4 w-4 shrink-0 text-muted",
  };
  if (name === "clock")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2.5 1.5" />
      </svg>
    );
  if (name === "admin")
    return (
      <svg {...common}>
        <path d="M2.5 10a5.5 5.5 0 1 1 11 0" />
        <path d="M8 10 10.5 6" />
        <path d="M2.5 12.5h11" />
      </svg>
    );
  if (name === "user")
    return (
      <svg {...common}>
        <circle cx="8" cy="5.5" r="2.5" />
        <path d="M2.8 13.5c0-2.4 2.2-4 5.2-4s5.2 1.6 5.2 4" />
      </svg>
    );
  if (name === "user-plus")
    return (
      <svg {...common}>
        <circle cx="6.5" cy="5.5" r="2.5" />
        <path d="M1.8 13.5c0-2.4 2-4 4.7-4 1.1 0 2.1.3 2.9.8" />
        <path d="M12 8.5v4M10 10.5h4" />
      </svg>
    );
  if (name === "gear")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="2.2" />
        <path d="m8 1.5 1 1.7 2-.3 1.3 1.6 1.7 1-.3 2 1 1.5-1 1.5.3 2-1.7 1-1.3 1.6-2-.3-1 1.7-1-1.7-2 .3L3.7 13l-1.7-1 .3-2-1-1.5 1-1.5-.3-2 1.7-1L5 2.9l2 .3z" />
      </svg>
    );
  if (name === "logout")
    return (
      <svg {...common}>
        <path d="M6.5 2H3v12h3.5" />
        <path d="M9 5.5 12 8l-3 2.5M6 8h6" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v6M5 8h6" />
    </svg>
  );
}

export default function SidebarUserMenu({ user }: { user: MenuUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [oooOpen, setOooOpen] = useState(false);
  const [oooFrom, setOooFrom] = useState(user.out_of_office_from ?? "");
  const [oooTo, setOooTo] = useState(user.out_of_office_to ?? "");
  const [oooNote, setOooNote] = useState(user.out_of_office_note ?? "");
  const [oooSaving, setOooSaving] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ left: rect.right + 8, bottom: window.innerHeight - rect.bottom });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
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

  const logout = async (switchAccount = false) => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push(switchAccount ? "/login?switch=1" : "/login");
    router.refresh();
  };

  const saveOoo = async () => {
    setOooSaving(true);
    try {
      const res = await fetch("/api/me/out-of-office", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: oooFrom || null,
          to: oooTo || null,
          note: oooNote,
        }),
      });
      if (!res.ok) {
        toastMessage(`不在設定の保存に失敗しました: ${res.status}`);
        return;
      }
      setOooOpen(false);
      router.refresh();
    } finally {
      setOooSaving(false);
    }
  };

  const item = "flex h-9 w-full items-center gap-2 rounded px-3 text-left text-[13px] text-text hover:bg-neutral-100";
  const oooLabel = oooFrom ? `不在: ${oooFrom}${oooTo ? ` 〜 ${oooTo}` : ""}` : "";

  return (
    <>
      <button
        ref={ref}
        type="button"
        data-sidebar-user-menu
        data-user-out-of-office={oooLabel}
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
            ref={menuRef}
            role="menu"
            data-user-menu
            className="fixed z-[130] w-64 rounded-lg border border-line bg-surface py-1 text-text shadow-xl"
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            <div className="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5">
              <UserAvatar name={user.name} url={user.avatar_url} className="h-10 w-10" textClassName="text-sm" />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="truncate text-sm font-semibold">{user.name}</span>
                  {user.is_guest && (
                    <span className="rounded bg-amber-100 px-1 text-[10px] text-warning">ゲスト</span>
                  )}
                </div>
                <div className="truncate text-[11px] text-muted">{user.email ?? ""}</div>
                {user.title && <div className="truncate text-[11px] text-muted">{user.title}</div>}
                {oooLabel && (
                  <div data-user-ooo-status className="mt-0.5 truncate text-[11px] text-blue-700">
                    {oooLabel}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              data-user-ooo
              onClick={() => {
                setOpen(false);
                setOooOpen(true);
              }}
              className={`${item} mt-1`}
            >
              <MenuIcon name="clock" />
              不在に設定
            </button>
            {user.is_admin && (
              <>
                <Link href="/admin" onClick={() => setOpen(false)} data-user-menu-admin className={item}>
                  <MenuIcon name="admin" />
                  管理者コンソール
                </Link>
                <button
                  type="button"
                  data-user-menu-invite
                  onClick={() => {
                    setOpen(false);
                    setInviteOpen(true);
                  }}
                  className={item}
                >
                  <MenuIcon name="user-plus" />
                  メンバーを招待
                </button>
                <div className="my-1 border-t border-line-subtle" />
              </>
            )}
            <Link href="/profile" onClick={() => setOpen(false)} data-user-menu-profile className={item}>
              <MenuIcon name="user" />
              プロフィール
            </Link>
            <Link href="/profile#settings" onClick={() => setOpen(false)} data-user-menu-settings className={item}>
              <MenuIcon name="gear" />
              設定
            </Link>
            <div className="my-1 border-t border-line-subtle" />
            <button
              type="button"
              data-user-switch-account
              onClick={() => void logout(true)}
              className={item}
            >
              <MenuIcon name="user-plus" />
              別のアカウントを追加
            </button>
            <button type="button" data-user-logout onClick={() => void logout()} className={item}>
              <MenuIcon name="logout" />
              ログアウト
            </button>
          </div>,
          document.body,
        )}

      {oooOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-4"
            onClick={() => setOooOpen(false)}
          >
            <div
              data-user-ooo-dialog
              className="w-[26rem] max-w-[92vw] rounded-lg bg-surface p-5 text-text shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="font-bold">不在に設定</h2>
              <p className="mt-1 text-[12px] text-muted">
                不在の期間を設定します。期間中は担当者メニューに表示されます。
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-[12px] text-secondary">
                  開始日
                  <input
                    type="date"
                    data-user-ooo-from
                    value={oooFrom}
                    onChange={(e) => setOooFrom(e.target.value)}
                    className="mt-1 w-full rounded border border-line-strong px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-[12px] text-secondary">
                  終了日
                  <input
                    type="date"
                    data-user-ooo-to
                    value={oooTo}
                    onChange={(e) => setOooTo(e.target.value)}
                    className="mt-1 w-full rounded border border-line-strong px-2 py-1 text-sm"
                  />
                </label>
              </div>
              <label className="mt-2 block text-[12px] text-secondary">
                メモ
                <textarea
                  data-user-ooo-note
                  value={oooNote}
                  onChange={(e) => setOooNote(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded border border-line-strong px-2 py-1 text-sm"
                  placeholder="例: 休暇のため返信が遅れます"
                />
              </label>
              <div className="mt-4 flex justify-end gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setOooOpen(false)}
                  className="rounded px-3 py-1 text-secondary hover:bg-neutral-100"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  data-user-ooo-save
                  disabled={oooSaving || !oooFrom}
                  onClick={() => void saveOoo()}
                  className="rounded bg-blue-600 px-4 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <InviteUserDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}
