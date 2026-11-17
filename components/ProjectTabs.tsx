"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import Link from "next/link";
import NavPending from "./NavPending";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectTab } from "@/lib/data";
import { api } from "@/lib/api-client";
import { confirmAction, toast } from "@/lib/ui-feedback";
import { useMenuKeyboard } from "@/lib/use-menu-keyboard";
import type { ProjectTabViewOption } from "@/lib/project-tab-views";
import ProjectTabAddMenu from "./project/ProjectTabAddMenu";
import ProjectTabContextMenu, { type ProjectTabMenuAction } from "./project/ProjectTabContextMenu";

const TAB_GAP = 4;
const DEFAULT_ADD_BUTTON_WIDTH = 28;
const DEFAULT_OVERFLOW_BUTTON_WIDTH = 74;

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
  const [isWide, setIsWide] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<string[] | null>(null);
  const [overflowMenu, setOverflowMenu] = useState<{ left: number; top: number } | null>(null);
  // The tab row shares one line with the title and actions. When the task pane
  // narrows the column, the real floor is the active tab plus overflow/add, so
  // start at zero and let the measurement below decide.
  const [navMinWidth, setNavMinWidth] = useState(0);

  const addButtonRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const droppedRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const renameBusyRef = useRef(false);
  const orderRef = useRef(order);
  const navRef = useRef<HTMLElement>(null);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const visibleKeysRef = useRef<string[] | null>(null);

  const closeOverflowMenu = (restoreFocus = false) => {
    setOverflowMenu(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => overflowButtonRef.current?.focus({ preventScroll: true }));
    }
  };

  useMenuKeyboard({
    open: overflowMenu !== null,
    containerRef: overflowMenuRef,
    onClose: () => closeOverflowMenu(true),
  });

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
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setIsWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!renameKey) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renameKey]);

  const activeKey = activeTabKey ?? tabs.find((tab) => tab.view_type === active)?.tab_key ?? null;

  useLayoutEffect(() => {
    if (!isWide) {
      visibleKeysRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisibleKeys(null);
      return;
    }
    const nav = navRef.current;
    if (!nav) return;

    const applyVisibleKeys = (next: string[] | null) => {
      const previous = visibleKeysRef.current;
      if (
        previous === next ||
        (previous &&
          next &&
          previous.length === next.length &&
          previous.every((key, index) => key === next[index]))
      ) {
        return;
      }
      visibleKeysRef.current = next;
      setVisibleKeys(next);
    };

    const measure = () => {
      const available = nav.clientWidth;
      if (available <= 0) return;
      const widths = order.map((tab) => {
        const measured = tabRefs.current.get(tab.tab_key)?.getBoundingClientRect().width ?? 0;
        return measured > 0 ? measured : tab.name.length * 14 + 16 + (tab.icon ? 16 : 0);
      });
      const measuredOverflowWidth = overflowButtonRef.current?.getBoundingClientRect().width ?? 0;
      const overflowWidth = measuredOverflowWidth > 0 ? measuredOverflowWidth : DEFAULT_OVERFLOW_BUTTON_WIDTH;
      const addButton = addButtonRef.current;
      // A container query hides the add button in a very narrow header; do not
      // reserve space for a control that is not rendered.
      const addVisible = canEdit && addButton !== null && addButton.getClientRects().length > 0;
      const measuredAddWidth = addVisible ? addButton.getBoundingClientRect().width : 0;
      const addWidth = measuredAddWidth > 0 ? measuredAddWidth : DEFAULT_ADD_BUTTON_WIDTH;
      const addReserve = addVisible ? addWidth + TAB_GAP : 0;
      const overflowReserve = overflowWidth + TAB_GAP;
      const total =
        widths.reduce((sum, width, index) => sum + width + (index > 0 ? TAB_GAP : 0), 0) + addReserve;
      if (total <= available) {
        setNavMinWidth((current) => (current === 0 ? current : 0));
        applyVisibleKeys(null);
        return;
      }

      const pinned = order
        .filter((tab) => tab.tab_key === activeKey || (renameKey !== null && tab.tab_key === renameKey))
        .map((tab) => tab.tab_key);
      const widthOf = (keys: string[]) =>
        keys.reduce(
          (sum, key, index) =>
            sum + (widths[order.findIndex((tab) => tab.tab_key === key)] ?? 0) + (index > 0 ? TAB_GAP : 0),
          0,
        );
      const requiredNavWidth = Math.ceil(widthOf(pinned) + overflowReserve + addReserve) + 1;
      setNavMinWidth((current) => (current === requiredNavWidth ? current : requiredNavWidth));
      const budget = available - overflowReserve - addReserve;
      if (budget <= 0) {
        applyVisibleKeys(pinned);
        return;
      }

      const chosen: string[] = [];
      let used = 0;
      for (let index = 0; index < order.length; index += 1) {
        const next = used + (chosen.length > 0 ? TAB_GAP : 0) + widths[index];
        if (next > budget) break;
        chosen.push(order[index].tab_key);
        used = next;
      }

      for (const key of pinned) {
        if (!chosen.includes(key)) chosen.push(key);
      }
      const chosenByOrder = (keys: string[]) =>
        order.filter((tab) => keys.includes(tab.tab_key)).map((tab) => tab.tab_key);
      let candidate = chosenByOrder(chosen);
      while (widthOf(candidate) > budget) {
        let removeAt = -1;
        for (let index = candidate.length - 1; index >= 0; index -= 1) {
          if (!pinned.includes(candidate[index])) {
            removeAt = index;
            break;
          }
        }
        if (removeAt < 0) break;
        candidate = candidate.filter((_, index) => index !== removeAt);
      }
      applyVisibleKeys(candidate);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    for (const element of tabRefs.current.values()) observer.observe(element);
    if (overflowButtonRef.current) observer.observe(overflowButtonRef.current);
    if (addButtonRef.current) observer.observe(addButtonRef.current);
    return () => observer.disconnect();
  }, [activeKey, canEdit, isWide, order, renameKey]);

  const hiddenTabs = visibleKeys ? order.filter((tab) => !visibleKeys.includes(tab.tab_key)) : [];
  const menuPosition = hiddenTabs.length > 0 ? overflowMenu : null;

  useEffect(() => {
    if (hiddenTabs.length > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverflowMenu(null);
  }, [hiddenTabs.length]);

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

  const openOverflowMenu = () => {
    const button = overflowButtonRef.current;
    const rect = button?.getBoundingClientRect();
    if (!button || !rect) return;
    button.focus({ preventScroll: true });
    const width = 200;
    setOverflowMenu({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: rect.bottom + 4,
    });
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
        ref={navRef}
        data-project-tabs
        style={isWide ? { minWidth: navMinWidth } : undefined}
        className="relative flex w-full items-center gap-[4px] overflow-x-auto px-6 py-[3px] text-sm whitespace-nowrap md:w-auto md:flex-1 md:overflow-clip md:px-0 md:py-0 md:[overflow-clip-margin:8px]"
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
          const isHidden = visibleKeys !== null && !visibleKeys.includes(tab.tab_key);
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
              ref={(element) => {
                if (element) tabRefs.current.set(tab.tab_key, element);
                else tabRefs.current.delete(tab.tab_key);
              }}
              draggable={canEdit && !isRenaming && !isHidden}
              data-project-tab={tab.tab_key}
              data-project-tab-hidden={isHidden ? "true" : undefined}
              aria-hidden={isHidden || undefined}
              onDragStart={(event) => {
                if (!canEdit || isHidden) return;
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
                if (isImeComposing(event)) return;
                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenuAt(tab, rect.left + 8, rect.bottom + 2);
                }
              }}
              className={`flex shrink-0 items-center rounded-md ${
                isHidden ? "pointer-events-none invisible absolute top-0 left-0" : "relative"
              } ${dragId === tab.id ? "opacity-40" : ""}`}
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
                    if (isImeComposing(event)) return;
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
                  tabIndex={isHidden ? -1 : undefined}
                  onClick={(event) => {
                    if (draggingRef.current) event.preventDefault();
                  }}
                  className={linkClass}
                >
                  {tab.icon && <span className="mr-1 text-[13px] leading-none">{tab.icon}</span>}
                  {tab.name}
                  <NavPending className="ml-1" />
                </Link>
              )}
            </div>
          );
        })}
        <button
          ref={overflowButtonRef}
          type="button"
          data-project-tab-overflow={hiddenTabs.length > 0 ? "true" : undefined}
          data-project-tab-overflow-measure={hiddenTabs.length === 0 ? "true" : undefined}
          aria-label={hiddenTabs.length > 0 ? "その他" : undefined}
          aria-haspopup={hiddenTabs.length > 0 ? "menu" : undefined}
          aria-expanded={hiddenTabs.length > 0 ? menuPosition !== null : undefined}
          aria-hidden={hiddenTabs.length === 0 || undefined}
          tabIndex={hiddenTabs.length === 0 ? -1 : undefined}
          onClick={() => {
            if (hiddenTabs.length === 0) return;
            if (overflowMenu) closeOverflowMenu();
            else openOverflowMenu();
          }}
          className={`flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-secondary transition-colors hover:bg-surface-muted hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
            hiddenTabs.length > 0 ? "" : "pointer-events-none invisible absolute top-0 left-0"
          }`}
        >
          <span className="md:@max-[700px]:sr-only">その他</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
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
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-[rgba(38,38,38,0.03)] hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2c60b8] md:@max-[420px]:hidden"
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

      {menuPosition &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[80]" onMouseDown={() => closeOverflowMenu()} />
            <div
              ref={overflowMenuRef}
              role="menu"
              aria-label="その他のビュー"
              data-project-tab-overflow-menu
              style={{
                left: menuPosition.left,
                top: menuPosition.top,
                width: 200,
                maxHeight: `calc(100vh - ${menuPosition.top + 8}px)`,
              }}
              className="fixed z-[90] overflow-y-auto rounded-md border border-line bg-surface p-1 text-sm shadow-lg"
            >
              {hiddenTabs.map((tab) => (
                <Link
                  key={tab.id}
                  href={tabHref(projectId, tab)}
                  role="menuitem"
                  data-project-tab-overflow-item={tab.tab_key}
                  onClick={() => closeOverflowMenu()}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-text hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                >
                  {tab.icon && (
                    <span aria-hidden="true" className="text-[12px] leading-none">
                      {tab.icon}
                    </span>
                  )}
                  <span className="min-w-0 truncate">{tab.name}</span>
                </Link>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
