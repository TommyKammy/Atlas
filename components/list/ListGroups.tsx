"use client";

import { useQuickTask } from "../task/QuickTaskContext";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { Section, TaskRow } from "@/lib/data";
import type { ListGroupBy } from "@/lib/list-view";
import type { TaskRowContext } from "./TaskListRow";
import ListGroupAddRow from "./ListGroupAddRow";
import ListSectionBlock from "./ListSectionBlock";
import ListSubgroupRows from "./ListSubgroupRows";
import ListUngroupedSection from "./ListUngroupedSection";

export type SectionDropState = { id: number; side: "before" | "after" };

export type ListGroupsProps = {
  groups: {
    groupBy: ListGroupBy;
    group2: ListGroupBy | null;
    groupOrder: [string, TaskRow[]][];
    orderedSections: Section[];
    bySection: Map<number | null, TaskRow[]>;
    collapsedGroups: Set<string>;
    rowLimitFor: (key: string) => number;
  };
  render: {
    groupHeader: (
      key: string,
      name: string,
      count: number,
      depth?: number,
      sectionId?: number,
    ) => ReactNode;
    rowCtx: TaskRowContext;
    splitGroups: (items: TaskRow[], key: ListGroupBy) => [string, TaskRow[]][];
    showMoreRows: (key: string, total: number, shown: number) => ReactNode;
    addRow: (input: ReactNode, items: TaskRow[]) => ReactNode;
    ghostRow: (onClick: () => void, items: TaskRow[]) => ReactNode;
  };
  composer: {
    addingTo: number | string | null;
    setAddingTo: (value: number | string | null) => void;
    drafts: Record<string, string>;
    setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
    groupSections: Record<string, number | null>;
    setGroupSections: Dispatch<SetStateAction<Record<string, number | null>>>;
    sections: Section[];
    commitSectionTask: (id: number) => Promise<void>;
    commitGroupedTask: (key: string) => Promise<void>;
    cancelAddTask: (key: number | string) => void;
  };
  dnd: {
    sectionDrop: SectionDropState | null;
    sectionDragging: number | null;
    sectionDropSide: (id: number) => "before" | "after" | null;
    setSectionDrop: (drop: SectionDropState | null) => void;
    reorderSections: (sourceId: number, targetId: number, side: "before" | "after") => Promise<void>;
    appendToSection: (dragId: number, sectionId: number | null) => Promise<void>;
  };
};

/**
 * Renders flat groups or sections, their secondary subgroups, show-more
 * controls and the section-less bucket. All child components keep their
 * existing data-* contracts.
 */
export default function ListGroups({ groups, render, composer, dnd }: ListGroupsProps) {
  const quick = useQuickTask();
  const { groupBy, group2, groupOrder, orderedSections, bySection, collapsedGroups, rowLimitFor } =
    groups;
  const { groupHeader, rowCtx, splitGroups, showMoreRows, addRow, ghostRow } = render;
  const {
    addingTo,
    setAddingTo,
    drafts,
    setDrafts,
    groupSections,
    setGroupSections,
    sections,
    commitGroupedTask,
    cancelAddTask,
  } = composer;
  const {
    sectionDrop,
    sectionDragging,
    sectionDropSide,
    setSectionDrop,
    reorderSections,
    appendToSection,
  } = dnd;

  const looseItems = bySection.get(null) ?? [];
  const shownLoose = looseItems.slice(0, rowLimitFor("none"));

  return (
    <>
      {groupBy !== "section"
        ? groupOrder.map(([groupKey, items]) => {
            const key = `g:${groupKey}`;
            const collapsed = collapsedGroups.has(key);
            const shownItems = items.slice(0, rowLimitFor(key));
            return (
              <div key={groupKey}>
                {groupHeader(key, groupKey, items.length)}
                {!collapsed && (
                  <>
                    <ListSubgroupRows
                      items={shownItems}
                      baseKey={key}
                      group2={group2}
                      collapsedGroups={collapsedGroups}
                      splitGroups={splitGroups}
                      rowCtx={rowCtx}
                      renderGroupHeader={groupHeader}
                    />
                    {showMoreRows(key, items.length, shownItems.length)}
                    {addingTo === key
                      ? addRow(
                          <ListGroupAddRow
                            draft={drafts[groupKey] ?? ""}
                            sectionValue={groupSections[groupKey] ?? sections[0]?.id ?? ""}
                            sections={sections}
                            onDraftChange={(value) =>
                              setDrafts((current) => ({ ...current, [groupKey]: value }))
                            }
                            onSectionChange={(sectionId) =>
                              setGroupSections((current) => ({ ...current, [groupKey]: sectionId }))
                            }
                            onCommit={() => void commitGroupedTask(groupKey)}
                            onCancel={() => cancelAddTask(groupKey)}
                          />,
                          items,
                        )
                      : ghostRow(() => setAddingTo(key), items)}
                  </>
                )}
              </div>
            );
          })
        : orderedSections.map((section) => {
            const key = `s:${section.id}`;
            const collapsed = collapsedGroups.has(key);
            const items = bySection.get(section.id) ?? [];
            const shownItems = items.slice(0, rowLimitFor(key));
            return (
              <ListSectionBlock
                key={section.id}
                sectionId={section.id}
                collapsed={collapsed}
                dropSide={sectionDrop?.id === section.id ? sectionDrop.side : null}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (sectionDragging !== null) {
                    const side = sectionDropSide(section.id);
                    setSectionDrop(side ? { id: section.id, side } : null);
                  }
                }}
                onDragLeave={(event) => {
                  if (sectionDragging === null) return;
                  const related = event.relatedTarget as Node | null;
                  if (related && (event.currentTarget as HTMLElement).contains(related)) return;
                  if (sectionDrop?.id === section.id) setSectionDrop(null);
                }}
                onDrop={(event) => {
                  if (sectionDragging !== null) {
                    event.preventDefault();
                    event.stopPropagation();
                    const source = Number(event.dataTransfer.getData("text/atlas-section"));
                    const side = sectionDropSide(section.id);
                    if (source && side) void reorderSections(source, section.id, side);
                    return;
                  }
                  event.preventDefault();
                  const dragId = Number(event.dataTransfer.getData("text/atlas-task"));
                  if (dragId) appendToSection(dragId, section.id);
                }}
                header={groupHeader(key, section.name, items.length, 0, section.id)}
              >
                <>
                  <ListSubgroupRows
                    items={shownItems}
                    baseKey={key}
                    group2={group2}
                    collapsedGroups={collapsedGroups}
                    splitGroups={splitGroups}
                    rowCtx={rowCtx}
                    renderGroupHeader={groupHeader}
                  />
                  {showMoreRows(key, items.length, shownItems.length)}
                  {ghostRow(() => quick?.create("task", section.id), items)}
                </>
              </ListSectionBlock>
            );
          })}
      <ListUngroupedSection
        total={looseItems.length}
        tasks={shownLoose}
        rowCtx={rowCtx}
        footer={<>
          {showMoreRows("none", looseItems.length, shownLoose.length)}
          {groupBy === "section" && ghostRow(() => quick?.create("task", null), looseItems)}
        </>}
      />
    </>
  );
}
