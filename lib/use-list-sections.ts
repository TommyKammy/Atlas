"use client";

import { useMemo, useState } from "react";
import type { Section } from "./data";
import { api } from "./api-client";
import type { SectionAnchor } from "./section-order";
import { useSectionDraft } from "./use-section-draft";
import { confirmAction, toast as toastMessage } from "./ui-feedback";

export type SectionDrop = { id: number; side: "before" | "after" };

/**
 * Section ordering, inline creation/rename, drag/drop and context-menu state
 * for the list view. Keeping this here leaves ListView focused on rows and
 * columns.
 */
export function useListSections({
  projectId,
  sections,
  refresh,
  onAddTask,
  onDragStart,
}: {
  projectId: number;
  sections: Section[];
  refresh: () => void;
  onAddTask: (sectionId: number, options?: { continuous?: boolean }) => void;
  onDragStart: () => void;
}) {
  const [optimisticSections, setOptimisticSections] = useState<Section[]>([]);
  const [sectionOrder, setSectionOrder] = useState<number[]>(() => sections.map((section) => section.id));
  const [sectionDragging, setSectionDragging] = useState<number | null>(null);
  const [sectionDrop, setSectionDrop] = useState<SectionDrop | null>(null);
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [sectionEditName, setSectionEditName] = useState("");
  const [sectionMenu, setSectionMenu] = useState<{ id: number; left: number; top: number } | null>(null);

  // A newly saved section stays visible with its returned id/position until
  // the server refresh includes it, so focus and the task composer survive.
  // Server rows take precedence; a removed section is dropped on delete.
  const allSections = useMemo(() => {
    const byId = new Map(sections.map((section) => [section.id, section]));
    for (const section of optimisticSections) {
      if (!byId.has(section.id)) byId.set(section.id, section);
    }
    return [...byId.values()].sort((a, b) => a.position - b.position || a.id - b.id);
  }, [sections, optimisticSections]);

  const sectionById = new Map(allSections.map((section) => [section.id, section]));
  const orderedSections = [
    ...sectionOrder
      .map((id) => sectionById.get(id))
      .filter((section): section is Section => Boolean(section)),
    ...allSections.filter((section) => !sectionOrder.includes(section.id)),
  ];

  const insertCreatedSection = (
    created: { id: number; name: string; position: number },
    anchor: SectionAnchor | null,
  ) => {
    setOptimisticSections((current) =>
      current.some((section) => section.id === created.id)
        ? current
        : [...current, { id: created.id, name: created.name, position: created.position }],
    );
    const ids = orderedSections.map((section) => section.id);
    let index = ids.length;
    if (anchor?.before !== undefined) {
      const found = ids.indexOf(anchor.before);
      if (found >= 0) index = found;
    } else if (anchor?.after !== undefined) {
      const found = ids.indexOf(anchor.after);
      if (found >= 0) index = found + 1;
    }
    if (!ids.includes(created.id)) ids.splice(index, 0, created.id);
    setSectionOrder(ids);
  };

  const sectionDraft = useSectionDraft({
    projectId,
    onCreated: (created, origin, anchor) => {
      insertCreatedSection(created, anchor);
      refresh();
      if (origin !== "enter") return;
      // Wait for the optimistic heading, then reuse the section's normal
      // quick-task composer so the first task can be typed immediately and
      // Enter keeps opening the next row.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`[data-list-section-block="${created.id}"]`)
            ?.scrollIntoView({ block: "nearest" });
          onAddTask(created.id, { continuous: true });
        });
      });
    },
  });

  const cancelSectionDraft = () => {
    const anchor = sectionDraft.anchor;
    sectionDraft.cancel();
    requestAnimationFrame(() => {
      const selector = anchor?.before !== undefined
        ? `[data-section-menu-button="${anchor.before}"]`
        : anchor?.after !== undefined
          ? `[data-section-menu-button="${anchor.after}"]`
          : "[data-add-section-open]";
      document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    });
  };

  const startSectionDraft = (anchor: SectionAnchor | null = null) => {
    setSectionMenu(null);
    setEditingSection(null);
    setSectionEditName("");
    // Let the context menu's focus restoration finish before the heading
    // mounts its auto-focused input; otherwise that restoration blurs an
    // empty draft and discards it immediately.
    requestAnimationFrame(() => sectionDraft.start(anchor));
  };

  const startSectionDrag = (event: React.DragEvent, id: number, name: string) => {
    if ((event.target as HTMLElement).closest("button,input,select,textarea,a")) {
      event.preventDefault();
      return;
    }
    const source = event.currentTarget as HTMLElement;
    const rect = source.getBoundingClientRect();
    const computed = window.getComputedStyle(source);
    const dragImage = document.createElement("div");
    dragImage.textContent = name;
    Object.assign(dragImage.style, {
      position: "fixed",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${Math.min(rect.width, 380)}px`,
      height: `${rect.height}px`,
      display: "flex",
      alignItems: "center",
      padding: "0 12px 0 40px",
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
      boxSizing: "border-box",
      background: "rgba(255, 255, 255, 0.9)",
      border: "1px solid var(--atlas-line)",
      borderRadius: "4px",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
      color: computed.color,
      fontFamily: computed.fontFamily,
      fontSize: "14px",
      fontWeight: "600",
      opacity: "0.8",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    document.body.appendChild(dragImage);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/atlas-section", String(id));
    event.dataTransfer.setDragImage(dragImage, 40, rect.height / 2);
    window.setTimeout(() => dragImage.remove(), 0);
    onDragStart();
    setSectionDragging(id);
    setSectionDrop(null);
  };

  const reorderSections = async (sourceId: number, targetId: number, side: "before" | "after") => {
    const ids = orderedSections.map((section) => section.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || sourceId === targetId) return;
    const [moved] = ids.splice(from, 1);
    let insert = to;
    if (from < to) insert -= 1;
    if (side === "after") insert += 1;
    ids.splice(insert, 0, moved);
    setSectionOrder(ids);
    setSectionDragging(null);
    setSectionDrop(null);
    try {
      await api("/api/sections/reorder", "POST", { project_id: projectId, ids });
      refresh();
    } catch {
      setSectionOrder(sections.map((section) => section.id));
      toastMessage("セクションの並び替えに失敗しました");
      refresh();
    }
  };

  const beginSectionEdit = (id: number, name: string) => {
    setSectionMenu(null);
    setSectionEditName(name);
    setEditingSection(id);
  };

  const saveSectionName = async (id: number) => {
    const name = sectionEditName.trim();
    const current = sections.find((section) => section.id === id)?.name ?? "";
    setEditingSection(null);
    setSectionEditName("");
    if (!name || name === current) return;
    try {
      await api(`/api/sections/${id}`, "PATCH", { name });
      refresh();
    } catch {
      toastMessage("セクション名の変更に失敗しました");
      refresh();
    }
  };

  const addTaskToSection = (id: number) => {
    setSectionMenu(null);
    onAddTask(id);
  };

  const openSectionMenu = (event: React.MouseEvent, id: number) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setSectionMenu({
      id,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 268)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 272)),
    });
  };

  const deleteSection = async (id: number, name: string) => {
    setSectionMenu(null);
    if (!(await confirmAction(`セクション「${name}」を削除しますか？`))) return;
    try {
      await api(`/api/sections/${id}`, "DELETE");
      setSectionOrder((prev) => prev.filter((sectionId) => sectionId !== id));
      setOptimisticSections((prev) => prev.filter((section) => section.id !== id));
      refresh();
    } catch {
      toastMessage("セクションの削除に失敗しました");
      refresh();
    }
  };

  const sectionDropSide = (targetId: number): "before" | "after" | null => {
    if (sectionDragging === null || sectionDragging === targetId) return null;
    const ids = orderedSections.map((section) => section.id);
    const from = ids.indexOf(sectionDragging);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return null;
    return from < to ? "after" : "before";
  };

  return {
    orderedSections,
    sectionDragging,
    setSectionDragging,
    sectionDrop,
    setSectionDrop,
    editingSection,
    setEditingSection,
    sectionEditName,
    setSectionEditName,
    sectionMenu,
    setSectionMenu,
    sectionDraft,
    startSectionDraft,
    cancelSectionDraft,
    startSectionDrag,
    reorderSections,
    beginSectionEdit,
    saveSectionName,
    addTaskToSection,
    openSectionMenu,
    deleteSection,
    sectionDropSide,
  };
}
