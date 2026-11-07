/** Shared task status chip colors, including common custom statuses. */
export function statusToneClass(status: string): string {
  const base = "inline-block rounded-full px-2 py-0.5 text-xs";
  if (status === "Done" || status === "完了") return `${base} bg-green-100 text-green-800`;
  if (status === "進行中" || status === "In Progress") return `${base} bg-blue-100 text-blue-800`;
  if (status === "未着手" || status === "To Do") return `${base} bg-neutral-100 text-neutral-700`;
  return `${base} bg-neutral-100 text-neutral-600`;
}
