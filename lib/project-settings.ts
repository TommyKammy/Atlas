/**
 * Shared project settings stored in `projects.settings` (JSONB).
 *
 * These values are intentionally small and serializable so the same module can
 * be used by server routes, dialogs, and tests.
 */

export const DEPENDENCY_BUFFER_MODES = ["buffer", "fill", "none"] as const;
export type DependencyBufferMode = (typeof DEPENDENCY_BUFFER_MODES)[number];

export const DEPENDENCY_BUFFER_LABELS: Record<DependencyBufferMode, string> = {
  buffer: "バッファを維持する",
  fill: "バッファを埋める",
  none: "なし",
};

export type WorkHours = { start: string; end: string };

export type ProjectNotifications = {
  email: boolean;
  in_app: boolean;
  slack: boolean;
  teams: boolean;
};

export type ProjectSharingLevel = "admins" | "editors";

export type ProjectSettings = {
  dependency_buffer: DependencyBufferMode;
  /** 0 = Sunday … 6 = Saturday. */
  work_days: number[];
  work_hours: WorkHours;
  notifications: ProjectNotifications;
  who_can_edit: ProjectSharingLevel;
  who_can_share: ProjectSharingLevel;
};

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  dependency_buffer: "buffer",
  work_days: [1, 2, 3, 4, 5],
  work_hours: { start: "09:00", end: "18:00" },
  notifications: { email: true, in_app: true, slack: false, teams: false },
  who_can_edit: "editors",
  who_can_share: "admins",
};

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function time(value: unknown, fallback: string): string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function level(value: unknown, fallback: ProjectSharingLevel): ProjectSharingLevel {
  return value === "admins" || value === "editors" ? value : fallback;
}

/** Coerce an arbitrary JSONB value into the supported settings shape. */
export function normalizeProjectSettings(raw: unknown): ProjectSettings {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const notificationRaw =
    value.notifications && typeof value.notifications === "object" && !Array.isArray(value.notifications)
      ? (value.notifications as Record<string, unknown>)
      : {};
  const hoursRaw =
    value.work_hours && typeof value.work_hours === "object" && !Array.isArray(value.work_hours)
      ? (value.work_hours as Record<string, unknown>)
      : {};
  const hasWorkDays = Array.isArray(value.work_days);
  const rawDays = hasWorkDays
    ? (value.work_days as unknown[])
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  const workDays = hasWorkDays
    ? [...new Set(rawDays)].sort((a, b) => a - b)
    : [...DEFAULT_PROJECT_SETTINGS.work_days];
  const mode = DEPENDENCY_BUFFER_MODES.includes(value.dependency_buffer as DependencyBufferMode)
    ? (value.dependency_buffer as DependencyBufferMode)
    : DEFAULT_PROJECT_SETTINGS.dependency_buffer;
  return {
    dependency_buffer: mode,
    work_days: workDays,
    work_hours: {
      start: time(hoursRaw.start, DEFAULT_PROJECT_SETTINGS.work_hours.start),
      end: time(hoursRaw.end, DEFAULT_PROJECT_SETTINGS.work_hours.end),
    },
    notifications: {
      email: bool(notificationRaw.email, DEFAULT_PROJECT_SETTINGS.notifications.email),
      in_app: bool(notificationRaw.in_app, DEFAULT_PROJECT_SETTINGS.notifications.in_app),
      slack: bool(notificationRaw.slack, DEFAULT_PROJECT_SETTINGS.notifications.slack),
      teams: bool(notificationRaw.teams, DEFAULT_PROJECT_SETTINGS.notifications.teams),
    },
    who_can_edit: level(value.who_can_edit, DEFAULT_PROJECT_SETTINGS.who_can_edit),
    who_can_share: level(value.who_can_share, DEFAULT_PROJECT_SETTINGS.who_can_share),
  };
}

/** Merge a partial settings patch over the current value (both normalized). */
export function mergeProjectSettings(current: unknown, patch: unknown): ProjectSettings {
  const base = normalizeProjectSettings(current);
  const raw = patch && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...base };
  for (const key of ["dependency_buffer", "work_days", "work_hours", "notifications", "who_can_edit", "who_can_share"] as const) {
    if (key in raw) next[key] = raw[key];
  }
  return normalizeProjectSettings(next);
}

export function workDaySummary(settings: ProjectSettings): string {
  const days = settings.work_days;
  if (days.length === 7) return "毎日";
  if (days.length === 5 && days.every((d) => d >= 1 && d <= 5)) return "平日（月〜金）";
  if (days.length === 0) return "なし";
  return days.map((day) => WEEKDAY_LABELS[day]).join("・");
}
