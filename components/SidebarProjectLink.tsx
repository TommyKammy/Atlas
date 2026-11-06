"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ProjectIcon from "./ProjectIcon";
import ShareLinks from "./ShareLinks";
import ProjectMembersManager from "./ProjectMembersManager";
import { PROJECT_COLORS, PROJECT_ICONS, projectColor } from "@/lib/project-appearance";

type CtxProject = {
  id: number;
  name: string;
  color?: string | null;
  icon?: string | null;
};

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.json().catch(() => ({}));
}

function MenuIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-4 w-4 shrink-0 text-neutral-500",
  };
  if (name === "share")
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
        <path d="M16 4h5v5M21 4l-6 6" />
      </svg>
    );
  if (name === "external")
    return (
      <svg {...common}>
        <path d="M14 4h6v6M20 4l-9 9" />
        <path d="M18 14v5H5V6h5" />
      </svg>
    );
  if (name === "link")
    return (
      <svg {...common}>
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
      </svg>
    );
  if (name === "palette")
    return (
      <svg {...common}>
        <path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.4-3.4 2 2 0 0 1 1.4-3.4H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3z" />
        <circle cx="7.5" cy="11" r=".8" fill="currentColor" />
        <circle cx="10" cy="7.5" r=".8" fill="currentColor" />
        <circle cx="14.5" cy="7" r=".8" fill="currentColor" />
      </svg>
    );
  if (name === "pencil")
    return (
      <svg {...common}>
        <path d="m4 20 4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16z" />
        <path d="m13.5 7.5 3 3" />
      </svg>
    );
  if (name === "star")
    return (
      <svg {...common}>
        <path d="m12 3 2.7 5.9 6.3.7-4.7 4.3 1.3 6.3-5.6-3.2-5.6 3.2 1.3-6.3L3 9.6l6.3-.7z" />
      </svg>
    );
  if (name === "plus")
    return (
      <svg {...common}>
        <path d="M4 4h16v16H4z" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M3 7h18v13H3z" />
      <path d="M3 7h18M9 7V4h6v3" />
      <path d="M10 12h4" />
    </svg>
  );
}

export default function SidebarProjectLink({
  project,
  href,
  className,
  starred = false,
  leading = "project",
}: {
  project: CtxProject;
  href: string;
  className: string;
  starred?: boolean;
  leading?: "project" | "star";
}) {
  const router = useRouter();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<null | "share" | "rename" | "appearance" | "archive">(null);
  const [starredState, setStarredState] = useState(starred);
  const [color, setColor] = useState(project.color ?? null);
  const [icon, setIcon] = useState(project.icon ?? null);
  const [renameVal, setRenameVal] = useState(project.name);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setStarredState(starred), [starred]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setColor(project.color ?? null), [project.color]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setIcon(project.icon ?? null), [project.icon]);

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };
  useEffect(() => {
    if (!pos && !dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPos(null);
        setDialog(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pos, dialog]);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const w = 225;
    const h = 302;
    setPos({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(e.clientY - 6, window.innerHeight - h - 8)),
    });
    setRenameVal(project.name);
  };

  const item =
    "flex h-9 w-full items-center gap-2 px-3 text-left text-[14px] text-neutral-800 hover:bg-neutral-100";

  const copyLink = async () => {
    setPos(null);
    try {
      await navigator.clipboard.writeText(`${location.origin}/projects/${project.id}?view=list`);
      showToast("リンクをコピーしました");
    } catch {
      showToast("リンクをコピーできませんでした");
    }
  };

  const toggleFavorite = async () => {
    setPos(null);
    setBusy(true);
    try {
      const data = await api("/api/favorites", "POST", { project_id: project.id });
      setStarredState(data.starred === true);
      showToast(data.starred ? "お気に入りに追加しました" : "お気に入りから削除しました");
      router.refresh();
    } catch {
      showToast("更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const addPortfolio = async () => {
    setPos(null);
    setBusy(true);
    try {
      await api("/api/portfolio", "POST", { project_id: project.id });
      showToast("マイポートフォリオに追加しました");
      router.refresh();
    } catch {
      showToast("追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async () => {
    const name = renameVal.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}`, "PATCH", { name });
      setDialog(null);
      showToast("プロジェクト名を変更しました");
      router.refresh();
    } catch {
      showToast("名前の変更に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const saveAppearance = async (patch: { color?: string | null; icon?: string | null }) => {
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}`, "PATCH", patch);
      if ("color" in patch) setColor(patch.color ?? null);
      if ("icon" in patch) setIcon(patch.icon ?? null);
      router.refresh();
    } catch {
      showToast("外観の更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}`, "PATCH", { archived: true });
      setDialog(null);
      showToast("プロジェクトをアーカイブしました");
      router.refresh();
    } catch {
      showToast("アーカイブに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const dialogCard = "max-w-[92vw] rounded-lg bg-white text-sm shadow-xl";
  const primary =
    "flex h-8 items-center rounded-md bg-[#4075cf] px-3 text-sm font-medium text-white hover:bg-[#3567b8] disabled:opacity-60";
  const secondary =
    "flex h-8 items-center rounded-md border bg-white px-3 text-sm text-neutral-700 hover:bg-neutral-50";

  return (
    <>
      <Link href={href} className={className} onContextMenu={openMenu}>
        {leading === "star" ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0 text-amber-300">
            <path d="m12 3 2.7 5.9 6.3.7-4.7 4.3 1.3 6.3-5.6-3.2-5.6 3.2 1.3-6.3L3 9.6l6.3-.7z" />
          </svg>
        ) : (
          <ProjectIcon
            id={project.id}
            name={project.name}
            color={color}
            icon={icon}
            className="h-4 w-4 text-[9px]"
          />
        )}
        <span className="truncate">{project.name}</span>
      </Link>

      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[80]"
              onMouseDown={() => setPos(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setPos(null);
              }}
            />
            <div
              role="menu"
              style={{ left: pos.x, top: pos.y }}
              className="fixed z-[90] w-[225px] rounded-md border bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
            >
              <button className={item} onClick={() => { setPos(null); setDialog("share"); }}>
                <MenuIcon name="share" /> プロジェクトを共有
              </button>
              <button className={item} onClick={() => { setPos(null); window.open(href, "_blank", "noopener"); }}>
                <MenuIcon name="external" /> 新しいタブで開く
              </button>
              <button className={item} onClick={copyLink}>
                <MenuIcon name="link" /> リンクをコピー
              </button>
              <button className={item} onClick={() => { setPos(null); setDialog("appearance"); }}>
                <MenuIcon name="palette" /> カラーとアイコンを設定
                <span className="ml-auto text-neutral-400">›</span>
              </button>
              <button className={item} onClick={() => { setPos(null); setRenameVal(project.name); setDialog("rename"); }}>
                <MenuIcon name="pencil" /> 名前を変更
              </button>
              <button className={item} disabled={busy} onClick={toggleFavorite}>
                <MenuIcon name="star" /> {starredState ? "お気に入りから削除" : "お気に入りに追加"}
              </button>
              <button className={item} disabled={busy} onClick={addPortfolio}>
                <MenuIcon name="plus" /> ポートフォリオに追加
              </button>
              <button className={item} onClick={() => { setPos(null); setDialog("archive"); }}>
                <MenuIcon name="archive" /> プロジェクトをアーカイブ
              </button>
            </div>
          </>,
          document.body,
        )}

      {dialog &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4"
            onMouseDown={() => !busy && setDialog(null)}
          >
            <div className={dialogCard} onMouseDown={(e) => e.stopPropagation()}>
              {dialog === "share" && (
                <div className="w-[min(560px,90vw)] p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">プロジェクトを共有</h2>
                    <button onClick={() => setDialog(null)} className="text-xl leading-none text-neutral-400 hover:text-neutral-700">×</button>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{project.name}</p>
                  <div className="mt-4 flex items-center gap-2">
                    <input
                      readOnly
                      value={`${location.origin}/projects/${project.id}?view=list`}
                      className="h-8 min-w-0 flex-1 rounded-md border bg-neutral-50 px-2 text-xs text-neutral-600"
                    />
                    <button
                      className={secondary}
                      onClick={() =>
                        navigator.clipboard
                          ?.writeText(`${location.origin}/projects/${project.id}?view=list`)
                          .then(() => showToast("リンクをコピーしました"))
                          .catch(() => showToast("リンクをコピーできませんでした"))
                      }
                    >
                      コピー
                    </button>
                  </div>
                  <ProjectMembersManager projectId={project.id} />
                  <ShareLinks projectId={project.id} />
                  <div className="mt-5 flex justify-end">
                    <button className={primary} onClick={() => setDialog(null)}>完了</button>
                  </div>
                </div>
              )}

              {dialog === "rename" && (
                <div className="w-[min(420px,90vw)] p-5">
                  <h2 className="text-lg font-semibold">名前を変更</h2>
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename();
                    }}
                    className="mt-3 h-9 w-full rounded-md border px-2 text-sm outline-none focus:border-[#4075cf]"
                  />
                  <div className="mt-4 flex justify-end gap-2">
                    <button className={secondary} onClick={() => setDialog(null)}>キャンセル</button>
                    <button className={primary} disabled={busy || !renameVal.trim()} onClick={saveRename}>保存</button>
                  </div>
                </div>
              )}

              {dialog === "appearance" && (
                <div className="w-[min(480px,90vw)] p-5">
                  <h2 className="text-lg font-semibold">カラーとアイコンを設定</h2>
                  <div className="mt-4 text-[13px] font-medium text-neutral-700">カラー</div>
                  <div className="mt-2 grid grid-cols-8 gap-2">
                    {PROJECT_COLORS.map((c) => (
                      <button
                        key={c.name}
                        title={c.name}
                        onClick={() => saveAppearance({ color: c.value })}
                        className={`flex h-6 w-6 items-center justify-center rounded-[5px] border border-black/10 text-xs text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.45)] ${
                          color === c.value ? "ring-2 ring-[#4075cf] ring-offset-1" : ""
                        }`}
                        style={{ backgroundColor: c.value ?? "#d9d9d9" }}
                      >
                        {color === c.value ? "✓" : ""}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 text-[13px] font-medium text-neutral-700">アイコン</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {PROJECT_ICONS.map((ic) => (
                      <button
                        key={ic.key ?? "none"}
                        title={ic.label}
                        onClick={() => saveAppearance({ icon: ic.key })}
                        className={`flex h-8 w-8 items-center justify-center rounded-md border text-[11px] ${
                          icon === ic.key ? "border-[#4075cf] bg-[#eff4fd] text-[#2C60B8]" : "text-neutral-500 hover:bg-neutral-50"
                        }`}
                      >
                        {ic.key ? (
                          <ProjectIcon
                            id={project.id}
                            name={project.name}
                            color={projectColor(project.id, color)}
                            icon={ic.key}
                            className="h-6 w-6 text-[9px]"
                          />
                        ) : (
                          "なし"
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-neutral-400">変更はすぐに保存されます。</p>
                  <div className="mt-4 flex justify-end">
                    <button className={primary} onClick={() => { setDialog(null); router.refresh(); }}>完了</button>
                  </div>
                </div>
              )}

              {dialog === "archive" && (
                <div className="w-[min(420px,90vw)] p-5">
                  <h2 className="text-lg font-semibold">プロジェクトをアーカイブ</h2>
                  <p className="mt-2 text-neutral-600">
                    「{project.name}」をアーカイブしますか？サイドバーから非表示になります。削除済みページから復元できます。
                  </p>
                  <div className="mt-5 flex justify-end gap-2">
                    <button className={secondary} onClick={() => setDialog(null)}>キャンセル</button>
                    <button
                      className="flex h-8 items-center rounded-md bg-[#c94848] px-3 text-sm font-medium text-white hover:bg-[#b83c3c] disabled:opacity-60"
                      disabled={busy}
                      onClick={archive}
                    >
                      アーカイブする
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {toast &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed bottom-6 left-1/2 z-[120] -translate-x-1/2 rounded-md bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>,
          document.body,
        )}
    </>
  );
}
