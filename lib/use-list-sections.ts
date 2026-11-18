"use client";

import { useState } from "react";
import type { Section } from "./data";
import { api } from "./api-client";
import { confirmAction, toast as toastMessage } from "./ui-feedback";

export type SectionDrop = { id: number; side: "before" | "after" };

/**
 * Section ordering, inline rename, drag/drop and context-menu state for the
 * list view. Keeping this here leaves ListView focused on rows and columns.
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
  onAddTask: (sectionId: number) => void;
  onDragStart: () => void;
}) {
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [sectionOrder, setSectionOrder] = useState<number[]>(() => sections.map((section) => section.id));
  const [sectionDragging, setSectionDragging] = useState<number | null>(null);
  const [sectionDrop, setSectionDrop] = useState<SectionDrop | null>(null);
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [sectionEditName, setSectionEditName] = useState("");
  const [sectionMenu, setSectionMenu] = useState<{ id: number; left: number; top: number } | null>(null);

  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const orderedSections = [
    ...sectionOrder
      .map((id) => sectionById.get(id))
      .filter((section): section is Section => Boolean(section)),
    ...sections.filter((section) => !sectionOrder.includes(section.id)),
  ];

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
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 176)),
    });
  };

  const deleteSection = async (id: number, name: string) => {
    setSectionMenu(null);
    if (!(await confirmAction(`セクション「${name}」を削除しますか？`))) return;
    try {
      await api(`/api/sections/${id}`, "DELETE");
      setSectionOrder((prev) => prev.filter((sectionId) => sectionId !== id));
      refresh();
    } catch {
      toastMessage("セクションの削除に失敗しました");
      refresh();
    }
  };

  const createSection = async () => {
    const name = sectionName.trim();
    if (!name) return;
    await api("/api/sections", "POST", { project_id: projectId, name });
    setSectionName("");
    setAddingSection(false);
    refresh();
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
    addingSection,
    setAddingSection,
    sectionName,
    setSectionName,
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
    startSectionDrag,
    reorderSections,
    beginSectionEdit,
    saveSectionName,
    addTaskToSection,
    openSectionMenu,
    deleteSection,
    createSection,
    sectionDropSide,
  };
}
