"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { moveListItem, orderByIds, type RelativePlacement } from "@/lib/list-order";
import type { SidebarProject } from "@/lib/repositories/sidebar-projects";
import { useListReorder } from "@/lib/use-list-reorder";
import SidebarProjectLink from "./SidebarProjectLink";

export default function SidebarProjectList({ workspaceId, projects, favoriteIds }: {
  workspaceId: number; projects: SidebarProject[]; favoriteIds: number[];
}) {
  const router = useRouter();
  const instructions = useId();
  const [order, setOrder] = useState(() => projects.map(project => project.id));
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const serverOrder = projects.map(project => project.id).join(",");
  useEffect(() => {
    // New server navigation/refresh is authoritative. During a request its
    // response supplies the newer order; current project metadata stays live.
    if (!pending.current) setOrder(serverOrder ? serverOrder.split(",").map(Number) : []);
  }, [serverOrder]);
  const sorted = orderByIds(projects, order);
  const move = async (id: number, targetId: number, placement: RelativePlacement) => {
    if (pending.current) return;
    const previous = sorted.map(project => project.id);
    const next = moveListItem(previous, id, targetId, placement);
    pending.current = true; setBusy(true); setError(""); setStatus("並び順を保存中…"); setOrder(next);
    try {
      const result = await api<{ order: number[] }>("/api/sidebar/projects/order", "POST", {
        workspace_id: workspaceId, project_id: id, target_id: targetId, placement,
      });
      setOrder(result.order); setStatus("並び順を保存しました");
      router.refresh();
    } catch {
      setOrder(previous); setStatus(""); setError("並び順を保存できませんでした。もう一度並べ替えてください。");
    } finally { pending.current = false; setBusy(false); }
  };
  const { listRef, drag, itemProps } = useListReorder({ ids: sorted.map(project => project.id), disabled: busy, includeTrailingSpace: true, onMove: (id, target, placement) => void move(id, target, placement) });
  return <>
    <p id={instructions} className="sr-only">プロジェクト名をクリックして開く、ドラッグして並べ替え。Alt と上下矢印でも移動できます。Escape でドラッグをキャンセル。</p>
    <div ref={listRef} data-sidebar-projects role="group" aria-label="プロジェクト" className="py-0.5">
      {sorted.map(project => {
        const target = drag?.active && drag.target?.id === project.id && drag.id !== project.id ? drag.target.placement : null;
        return <div key={project.id} data-sidebar-project={project.id} data-reorder-id={project.id}
          className={`relative flex min-w-0 items-center rounded-md hover:bg-sidebar-hover ${drag?.active && drag.id === project.id ? "opacity-40" : ""}`}>
          {target && <span data-project-drop={target} className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-sidebar-accent ${target === "before" ? "top-0" : "bottom-0"}`} />}
          <SidebarProjectLink project={project} href={`/projects/${project.id}`} starred={favoriteIds.includes(project.id)}
            reorderProps={{ ...itemProps<HTMLAnchorElement>(project.id, project.name), "aria-describedby": instructions }}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[14px] leading-[22px] text-sidebar-text focus-visible:outline-2 focus-visible:outline-sidebar-accent" />
        </div>;
      })}
    </div>
    <p role="status" aria-live="polite" data-project-order-status className="sr-only">{status}</p>
    {error && <p role="alert" className="px-2 py-1 text-xs text-sidebar-danger">{error}</p>}
    {drag?.active && createPortal(<div aria-hidden="true" className="pointer-events-none fixed z-50 max-w-60 truncate rounded-md bg-inverse-surface px-3 py-2 text-sm text-inverse-text-strong shadow-md"
      style={{ left: drag.x + 12, top: drag.y + 12 }}>{drag.title}</div>, document.body)}
  </>;
}
