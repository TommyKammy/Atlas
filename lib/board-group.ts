import { taskSectionId } from "./task-section";

export type BoardGroup<T> = {
  key: string;
  label: string;
  sectionId?: number;
  assigneeId?: number | null;
  status?: string;
  items: T[];
};

export type GroupableTask = {
  id: number;
  section_id: number | null;
  eff_section_id?: number | null;
  assignee_id: number | null;
  assignee_name: string | null;
  status: string;
  position: number;
};

export function groupBoardTasks<T extends GroupableTask>(
  tasks: T[],
  sectionIds: number[],
  groupBy: "section" | "assignee" | "status",
): BoardGroup<T>[] {
  if (groupBy === "section") {
    const groups: BoardGroup<T>[] = sectionIds.map((id) => ({
      key: `s${id}`,
      label: "",
      sectionId: id,
      items: [],
    }));
    const byId = new Map(groups.map((g) => [g.sectionId, g]));
    let loose: BoardGroup<T> | null = null;
    for (const t of tasks) {
      const k = taskSectionId(t);
      const g = k === null ? undefined : byId.get(k);
      if (g) g.items.push(t);
      else {
        if (!loose) {
          loose = { key: "s-none", label: "セクションなし", items: [] };
          groups.push(loose);
        }
        loose.items.push(t);
      }
    }
    for (const g of groups) {
      g.items.sort((a, b) => a.position - b.position || a.id - b.id);
    }
    return groups;
  }
  if (groupBy === "assignee") {
    const m = new Map<string, BoardGroup<T>>();
    for (const t of tasks) {
      const k = t.assignee_id === null ? "none" : `u${t.assignee_id}`;
      if (!m.has(k)) {
        m.set(k, {
          key: k,
          label: t.assignee_name ?? "（未割当）",
          assigneeId: t.assignee_id,
          items: [],
        });
      }
      m.get(k)!.items.push(t);
    }
    return [...m.values()].sort((a, b) =>
      a.label.startsWith("（") && !b.label.startsWith("（")
        ? 1
        : !a.label.startsWith("（") && b.label.startsWith("（")
          ? -1
          : a.label.localeCompare(b.label, "ja"),
    );
  }
  const m = new Map<string, BoardGroup<T>>();
  for (const t of tasks) {
    const k = t.status || "（未設定）";
    if (!m.has(k)) m.set(k, { key: k, label: k, status: t.status, items: [] });
    m.get(k)!.items.push(t);
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, "ja"));
}
