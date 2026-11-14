/** UI-only marker. Never sent to or stored in the task API. */
export function isQuickTask(task: object): boolean {
  return "quickAdd" in task && task.quickAdd === true;
}
