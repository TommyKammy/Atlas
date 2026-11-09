export const PROJECT_STATUS_COLORS = ["none", "green", "yellow", "red", "blue", "muted"] as const;
export type ProjectStatusColor = (typeof PROJECT_STATUS_COLORS)[number];

export const PROJECT_STATUS_OPTIONS = [
  { label: "順調", color: "green" },
  { label: "リスクあり", color: "yellow" },
  { label: "要対応", color: "red" },
  { label: "保留中", color: "blue" },
  { label: "完了", color: "green" },
  { label: "撤回済み", color: "muted" },
] as const satisfies readonly { label: string; color: ProjectStatusColor }[];

export function isProjectStatusColor(value: unknown): value is ProjectStatusColor {
  return typeof value === "string" && (PROJECT_STATUS_COLORS as readonly string[]).includes(value);
}

/** Asana-style status dot classes shared by the home widget and header chips. */
export function statusColorDot(color: string | null | undefined): string {
  if (color === "green") return "bg-green-600";
  if (color === "yellow") return "bg-amber-500";
  if (color === "red") return "bg-red-600";
  if (color === "blue") return "bg-blue-600";
  return "bg-neutral-400";
}
