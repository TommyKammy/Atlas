export type DashboardWidgetKey = "donut" | "trend" | "sections" | "assignees" | "status" | "overdue";

export const DEFAULT_WIDGETS: { key: DashboardWidgetKey; visible: boolean }[] = [
  { key: "donut", visible: true },
  { key: "trend", visible: true },
  { key: "sections", visible: true },
  { key: "assignees", visible: true },
  { key: "status", visible: true },
  { key: "overdue", visible: true },
];

export function normalizeWidgets(raw: unknown): { key: DashboardWidgetKey; visible: boolean }[] {
  const keys = new Set(DEFAULT_WIDGETS.map((w) => w.key));
  if (!Array.isArray(raw)) return DEFAULT_WIDGETS;
  const seen = new Set<string>();
  const out: { key: DashboardWidgetKey; visible: boolean }[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const k = (item as Record<string, unknown>).key;
    if (typeof k !== "string" || !keys.has(k as DashboardWidgetKey) || seen.has(k)) continue;
    seen.add(k);
    out.push({ key: k as DashboardWidgetKey, visible: (item as Record<string, unknown>).visible !== false });
  }
  for (const d of DEFAULT_WIDGETS) {
    if (!seen.has(d.key)) out.push({ ...d });
  }
  return out;
}
