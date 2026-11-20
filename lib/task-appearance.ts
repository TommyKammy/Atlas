/** Shared task status chip colors, including common custom statuses. */
export function statusToneClass(status: string): string {
  const base = "inline-block rounded-full px-2 py-0.5 text-xs";
  if (status === "Done" || status === "完了") return `${base} bg-success-soft text-success`;
  if (status === "進行中" || status === "In Progress") return `${base} bg-accent-soft text-accent-text`;
  if (status === "未着手" || status === "To Do") return `${base} bg-surface-muted text-secondary`;
  return `${base} bg-surface-muted text-secondary`;
}
