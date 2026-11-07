"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ProjectTab } from "@/lib/data";
import { api } from "@/lib/api-client";
import { confirmAction, toast } from "@/lib/ui-feedback";
import type { ProjectTabViewOption } from "@/lib/project-tab-views";
import ProjectTabAddMenu from "./project/ProjectTabAddMenu";
import ProjectTabContextMenu, { type ProjectTabMenuAction } from "./project/ProjectTabContextMenu";

function tabHref(projectId: number, tab: ProjectTab) {
  return `/projects/${projectId}?view=${tab.view_type}&tab=${encodeURIComponent(tab.tab_key)}`;
}

function moveTab(list: ProjectTab[], dragId: number, overId: number, after: boolean): ProjectTab[] {
  const from = list.findIndex((tab) => tab.id === dragId);
  const target = list.find((tab) => tab.id === overId);
  if (from < 0 || !target) return list;
  const next = list.filter((tab) => tab.id !== dragId);
  const targetIndex = next.findIndex((tab) => tab.id === overId);
  const insert = targetIndex < 0 ? next.length : targetIndex + (after ? 1 : 0);
  next.splice(insert, 0, list[from]);
  return next;
}

export default function ProjectTabs({
  projectId,
  active,
  activeTabKey,
  tabs,
  defaultTabKey,
  canEdit,
}: {
  projectId: number;
  active: string;
  activeTabKey: string | null;
  tabs: ProjectTab[];
  defaultTabKey: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [order, setOrder] = useState<ProjectTab[]>(tabs);
  const [menu, setMenu] = useState<{ tab: ProjectTab; x: number; y: number } | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; width: number } | null>(null);
  const [defaultKey, setDefaultKey] = useState<string | null>(defaultTabKey);
  const [busy, setBusy] = useState(false);
  const [busyView, setBusyView] = useState<string | null>(null);
  const [addError, setAddError] = useState("");
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  const addButtonRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const droppedRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const renameBusyRef = useRef(false);
  const orderRef = useRef(order);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(tabs);
    orderRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDefaultKey(defaultTabKey);
  }, [defaultTabKey]);

  useEffect(() => {
    if (!renameKey) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renameKey]);

  const activeKey = activeTabKey ?? tabs.find((tab) => tab.view_type === active)?.tab_key ?? null;

  const openMenuAt = (tab: ProjectTab, x: number, y: number) => {
    const width = 190;
    const height = 210;
    setMenu({
      tab,
      x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  };

  const openMenu = (event: React.MouseEvent, tab: ProjectTab) => {
    event.preventDefault();
    event.stopPropagation();
    openMenuAt(tab, event.clientX, event.clientY);
  };

  const saveRename = async (tab: ProjectTab) => {
    if (renameKey !== tab.tab_key) return;
    if (renameBusyRef.current) return;
    const name = renameValue.trim();
    if (name === "" || name === tab.name) {
      setRenameKey(null);
      return;
    }
    renameBusyRef.current = true;
    try {
      await api(`/api/project-tabs/${tab.id}`, "PATCH", { name });
      setOrder((current) => {
        const next = current.map((item) => (item.id === tab.id ? { ...item, name } : item));
        orderRef.current = next;
        return next;
      });
      setRenameKey(null);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "タブ名を変更できませんでした");
    } finally {
      renameBusyRef.current = false;
    }
  };

  const setDefaultTab = async (tab: ProjectTab) => {
    setBusy(true);
    try {
      await api("/api/view-state", "PUT", {
        project_id: projectId,
        view: "tabs",
        state: { default: tab.tab_key },
      });
      setDefaultKey(tab.tab_key);
      toast(`「${tab.name}」をデフォルトタブに設定しました`);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "デフォルトタブを設定できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const duplicateTab = async (tab: ProjectTab) => {
    setBusy(true);
    try {
      const created = await api<{ id: number; tab_key: string }>("/api/project-tabs", "POST", {
        project_id: projectId,
        name: `${tab.name} のコピー`,
        view_type: tab.view_type,
      });
      toast("タブをコピーしました");
      router.push(`/projects/${projectId}?view=${tab.view_type}&tab=${encodeURIComponent(created.tab_key)}`);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "タブをコピーできませんでした");
    } finally {
      setBusy(false);
    }
  };

  const copyTabLink = async (tab: ProjectTab) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${tabHref(projectId, tab)}`);
      toast("タブのリンクをコピーしました");
    } catch {
      toast("リンクをコピーできませんでした");
    }
  };

  const deleteTab = async (tab: ProjectTab) => {
    if (!(await confirmAction(`「${tab.name}」タブを削除しますか？`))) return;
    setBusy(true);
    try {
      await api(`/api/project-tabs/${tab.id}`, "DELETE");
      const current = orderRef.current;
      const removedIndex = current.findIndex((item) => item.id === tab.id);
      const next = current.filter((item) => item.id !== tab.id);
      setOrder(next);
      orderRef.current = next;
      if (activeKey === tab.tab_key) {
        const fallback = next[Math.min(Math.max(removedIndex, 0), next.length - 1)] ?? next[0];
        if (fallback) router.push(tabHref(projectId, fallback));
      }
      router.refresh();
      toast("タブを削除しました");
    } catch (error) {
      toast(error instanceof Error ? error.message : "タブを削除できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const runMenuAction = (action: ProjectTabMenuAction) => {
    const tab = menu?.tab;
    setMenu(null);
    if (!tab) return;
    if (action === "rename") {
      renameCancelledRef.current = false;
      setRenameKey(tab.tab_key);
      setRenameValue(tab.name);
    } else if (action === "default") {
      void setDefaultTab(tab);
    } else if (action === "duplicate") {
      void duplicateTab(tab);
    } else if (action === "copy") {
      void copyTabLink(tab);
    } else if (action === "delete") {
      void deleteTab(tab);
    }
  };

  const openAddMenu = () => {
    if (!canEdit) return;
    setAddError("");
    const rect = addButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(680, window.innerWidth - 16);
    setAddMenu({
      x: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      y: rect.bottom + 6,
      width,
    });
  };

  const addTab = async (option: ProjectTabViewOption) => {
    if (!canEdit || busyView) return;
    setBusyView(option.value);
    setAddError("");
    try {
      const created = await api<{ id: number; tab_key: string }>("/api/project-tabs", "POST", {
        project_id: projectId,
        name: option.label,
        view_type: option.value,
      });
      setAddMenu(null);
      router.push(`/projects/${projectId}?view=${option.value}&tab=${encodeURIComponent(created.tab_key)}`);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "タブを追加できませんでした");
    } finally {
      setBusyView(null);
    }
  };

  const persistOrder = async (next: ProjectTab[]) => {
    try {
      await api("/api/project-tabs/reorder", "POST", {
        project_id: projectId,
        ids: next.map((tab) => tab.id),
      });
      router.refresh();
    } catch {
      setOrder(tabs);
      orderRef.current = tabs;
      toast("タブの並び替えに失敗しました");
    }
  };

  return (
    <>
      <nav
        data-project-tabs
        className="relative flex items-center gap-1 overflow-x-auto px-6 py-[3px] text-sm whitespace-nowrap"
        onDragOver={(event) => {
          if (dragId !== null) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!canEdit || dragId === null) return;
          event.preventDefault();
          droppedRef.current = true;
          setDragId(null);
          setDragOverId(null);
          void persistOrder(orderRef.current);
        }}
      >
        {order.map((tab) => {
          const isActive = activeKey === tab.tab_key;
          const isRenaming = renameKey === tab.tab_key;
          const isDragOver = dragOverId === tab.id && dragId !== null;
          const linkClass = `flex h-7 items-center rounded-md px-2 text-[14px] font-medium transition-colors ${
            isActive
              ? "bg-[#eff4fd] text-[#2c60b8] hover:bg-[#e1ebfc] hover:text-[#1b4da0]"
              : "text-[#636363] hover:bg-[rgba(38,38,38,0.03)] hover:text-[#050505]"
          } ${
            isDragOver
              ? isActive
                ? "bg-[#e1ebfc] text-[#1b4da0]"
                : "bg-[rgba(38,38,38,0.03)] text-[#050505]"
              : ""
          }`;
          return (
            <div
              key={tab.id}
              draggable={canEdit && !isRenaming}
              data-project-tab={tab.tab_key}
              onDragStart={(event) => {
                if (!canEdit) return;
                draggingRef.current = true;
                droppedRef.current = false;
                setDragId(tab.id);
                setDragOverId(tab.id);
                event.dataTransfer.setData("text/atlas-tab", String(tab.id));
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (!canEdit || dragId === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverId(tab.id);
                if (tab.id === dragId) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const after = event.clientX > rect.left + rect.width / 2;
                setOrder((current) => {
                  const next = moveTab(current, dragId, tab.id, after);
                  orderRef.current = next;
                  return next;
                });
              }}
              onDrop={(event) => {
                if (!canEdit || dragId === null) return;
                event.preventDefault();
                event.stopPropagation();
                droppedRef.current = true;
                setDragId(null);
                setDragOverId(null);
                void persistOrder(orderRef.current);
              }}
              onDragEnd={() => {
                window.setTimeout(() => {
                  draggingRef.current = false;
                }, 0);
                setDragId(null);
                setDragOverId(null);
                if (!droppedRef.current) {
                  setOrder(tabs);
                  orderRef.current = tabs;
                }
                droppedRef.current = false;
              }}
              onContextMenu={(event) => openMenu(event, tab)}
              onKeyDown={(event) => {
                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenuAt(tab, rect.left + 8, rect.bottom + 2);
                }
              }}
              className={`relative flex shrink-0 items-center rounded-md ${
                dragId === tab.id ? "opacity-40" : ""
              }`}
            >
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => {
                    if (!renameCancelledRef.current) void saveRename(tab);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      renameCancelledRef.current = false;
                      void saveRename(tab);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      renameCancelledRef.current = true;
                      setRenameKey(null);
                    }
                  }}
                  data-project-tab-rename-input={tab.tab_key}
                  aria-label={`${tab.name}タブの名前`}
                  className="h-7 w-32 rounded-md border border-[#2c60b8] bg-white px-2 text-[14px] font-medium text-neutral-900 outline-none"
                />
              ) : (
                <Link
                  href={tabHref(projectId, tab)}
                  aria-current={isActive ? "page" : undefined}
                  onClick={(event) => {
                    if (draggingRef.current) event.preventDefault();
                  }}
                  className={linkClass}
                >
                  {tab.icon && <span className="mr-1 text-[13px] leading-none">{tab.icon}</span>}
                  {tab.name}
                </Link>
              )}
            </div>
          );
        })}
        {canEdit && (
          <button
            ref={addButtonRef}
            type="button"
            data-project-tab-add
            aria-label="タブを追加"
            aria-haspopup="menu"
            aria-expanded={addMenu !== null}
            onClick={() => {
              if (addMenu) setAddMenu(null);
              else openAddMenu();
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-[rgba(38,38,38,0.03)] hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2c60b8]"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </nav>

      {menu && (
        <ProjectTabContextMenu
          tab={menu.tab}
          pos={{ x: menu.x, y: menu.y }}
          isDefault={menu.tab.tab_key === defaultKey}
          canEdit={canEdit}
          canDelete={order.length > 1 && menu.tab.tab_key !== defaultKey}
          busy={busy}
          onClose={() => setMenu(null)}
          onAction={runMenuAction}
        />
      )}

      {canEdit && addMenu && (
        <ProjectTabAddMenu
          pos={addMenu}
          busyView={busyView}
          error={addError}
          onSelect={(option) => void addTab(option)}
          onClose={() => {
            setAddMenu(null);
            setAddError("");
          }}
        />
      )}
    </>
  );
}
