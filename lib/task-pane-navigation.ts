/** Preserve complete list/saved/dashboard context when closing a task detail pane. */
export function taskPaneCloseHref(projectId: number, view: string, search: string): string {
  const fallback = `/projects/${projectId}?view=${view}`;
  if (view !== "list") return fallback;
  const params = new URLSearchParams(search);
  // Invalid and empty selections must keep their fail-closed list context too.
  if (!params.has("dashboard") && params.get("list_state") !== "1" && !params.has("saved")) return fallback;
  params.delete("task");
  return `/projects/${projectId}?${params.toString()}`;
}
