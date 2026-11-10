export const SCHEDULED_TRIGGER_DEFAULTS = {
  "task.due_soon": 1,
  "task.overdue": 0,
} as const;

export function defaultTriggerDays(event: string): number | undefined {
  if (!Object.hasOwn(SCHEDULED_TRIGGER_DEFAULTS, event)) return undefined;
  return SCHEDULED_TRIGGER_DEFAULTS[event as keyof typeof SCHEDULED_TRIGGER_DEFAULTS];
}
