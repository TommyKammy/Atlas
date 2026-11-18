import { PROJECT_STATUS_DOT_CLASSES } from "./data-colors";

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

export function statusColorDot(color: string | null | undefined): string {
  if (color === "green") return PROJECT_STATUS_DOT_CLASSES.green;
  if (color === "yellow") return PROJECT_STATUS_DOT_CLASSES.yellow;
  if (color === "red") return PROJECT_STATUS_DOT_CLASSES.red;
  if (color === "blue") return PROJECT_STATUS_DOT_CLASSES.blue;
  return PROJECT_STATUS_DOT_CLASSES.muted;
}
