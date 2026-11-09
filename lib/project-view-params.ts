import type { ViewState } from "./data";
import {
  parseListDateFilter,
  parseListGroupBy,
  parseListSortKey,
  type ListDateFilter,
  type ListGroupBy,
  type ListSortKey,
} from "./list-view";
import type { SavedView } from "./repositories/projects";

export type SearchParams = { [key: string]: string | string[] | undefined };

export const PROJECT_VIEWS = new Set([
  "overview",
  "dashboard",
  "list",
  "board",
  "timeline",
  "calendar",
  "messages",
  "knowledge",
  "files",
  "forms",
]);

export type ParsedProjectViewSearch = {
  explicitView: string | null;
  view: string;
  taskId: number | null;
  month: string;
  week: string | null;
  savedId: number | null;
  sortRaw: string;
  sortDirParam: "asc" | "desc";
  dueParam: string;
  fromDay: number | null;
  groupRaw: string;
};

export function searchParamString(searchParams: SearchParams, key: string): string {
  const value = searchParams[key];
  return typeof value === "string" ? value : "";
}

function isValidDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Normalize the project page's URL parameters once, before view loaders run. */
export function parseProjectViewSearch(
  searchParams: SearchParams,
  now: Date = new Date(),
): ParsedProjectViewSearch {
  const viewParam = searchParamString(searchParams, "view");
  const explicitView = PROJECT_VIEWS.has(viewParam) ? viewParam : null;
  const taskRaw = searchParamString(searchParams, "task");
  const monthRaw = searchParamString(searchParams, "month");
  const weekRaw = searchParamString(searchParams, "week");
  const savedRaw = searchParamString(searchParams, "saved");
  const sortRaw = searchParamString(searchParams, "sort");
  const dueRaw = searchParamString(searchParams, "due");
  const fromRaw = searchParamString(searchParams, "from");

  return {
    explicitView,
    view: explicitView ?? "list",
    taskId: /^\d+$/.test(taskRaw) ? Number(taskRaw) : null,
    month: /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : now.toISOString().slice(0, 7),
    week: searchParamString(searchParams, "zoom") === "week" && isValidDay(weekRaw) ? weekRaw : null,
    savedId: /^\d+$/.test(savedRaw) ? Number(savedRaw) : null,
    sortRaw,
    sortDirParam: searchParamString(searchParams, "sortdir") === "desc" ? "desc" : "asc",
    dueParam: ["overdue", "today", "week", "nextweek", "month"].includes(dueRaw) ? dueRaw : "",
    fromDay: isValidDay(fromRaw) ? Math.floor(Date.parse(fromRaw) / 86400000) : null,
    groupRaw: searchParamString(searchParams, "group"),
  };
}

function storedString(stored: ViewState | undefined, key: string, allowed?: readonly string[]): string {
  const value = stored?.[key];
  return typeof value === "string" && (allowed === undefined || allowed.includes(value)) ? value : "";
}

function storedBool(stored: ViewState | undefined, key: string): boolean {
  return stored?.[key] === true;
}

function storedBoolDefault(stored: ViewState | undefined, key: string, fallback: boolean): boolean {
  const value = stored?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function searchOrStored(
  searchParams: SearchParams,
  stored: ViewState | undefined,
  key: string,
  allowed?: readonly string[],
): string {
  const urlValue = searchParamString(searchParams, key);
  if (urlValue !== "") return urlValue;
  return storedString(stored, key, allowed);
}

export type ListInitial = {
  hide_completed: boolean;
  completed_only: boolean;
  mine_only: boolean;
  assignee: string;
  status: string;
  due: string;
  start: ListDateFilter;
  creator: string;
  created: ListDateFilter;
  updated: ListDateFilter;
  completed_on: ListDateFilter;
  sort: ListSortKey;
  sortdir: "asc" | "desc";
  group: ListGroupBy;
  group2?: ListGroupBy;
  groupdir: "asc" | "desc";
  subtasks_collapsed: boolean;
};

/** Saved view values win over URL parameters, which win over persisted state. */
export function buildListInitial({
  searchParams,
  stored,
  saved,
  statusFieldEnabled,
}: {
  searchParams: SearchParams;
  stored?: ViewState;
  saved?: SavedView;
  statusFieldEnabled: boolean;
}): ListInitial {
  const filters = saved?.filters;
  const rawGroup2 = saved
    ? (filters?.group2 ?? "")
    : searchOrStored(searchParams, stored, "group2");
  const parsedGroup2 = rawGroup2 ? parseListGroupBy(rawGroup2, statusFieldEnabled) : null;
  const dueRaw = searchParamString(searchParams, "due");
  const dueParam = ["overdue", "today", "week", "nextweek", "month"].includes(dueRaw) ? dueRaw : "";

  return {
    hide_completed: saved
      ? filters?.hide_completed === true
      : searchParams.hide !== undefined
        ? searchParamString(searchParams, "hide") === "1"
        : searchParamString(searchParams, "completed") === "open"
          ? true
          : storedBool(stored, "hide_completed"),
    completed_only: saved
      ? filters?.completed_only === true
      : searchParamString(searchParams, "completed") === "done"
        ? true
        : storedBool(stored, "completed_only"),
    mine_only: saved
      ? filters?.mine_only === true
      : searchParamString(searchParams, "mine") !== ""
        ? searchParamString(searchParams, "mine") === "1"
        : storedBool(stored, "mine_only"),
    assignee: saved
      ? (filters?.assignee ?? "")
      : searchOrStored(searchParams, stored, "assignee"),
    status: saved
      ? (filters?.status ?? "")
      : searchOrStored(searchParams, stored, "status"),
    due: saved
      ? (filters?.due ?? "")
      : dueParam !== ""
        ? dueParam
        : storedString(stored, "due", ["overdue", "today", "week", "nextweek", "month"]),
    start: parseListDateFilter(
      saved
        ? filters?.start
        : searchParamString(searchParams, "start") !== ""
          ? searchParamString(searchParams, "start")
          : storedString(stored, "start"),
    ),
    creator: saved
      ? (filters?.creator ?? "")
      : searchOrStored(searchParams, stored, "creator"),
    created: parseListDateFilter(
      saved
        ? filters?.created
        : searchParamString(searchParams, "created") !== ""
          ? searchParamString(searchParams, "created")
          : storedString(stored, "created"),
    ),
    updated: parseListDateFilter(
      saved
        ? filters?.updated
        : searchParamString(searchParams, "updated") !== ""
          ? searchParamString(searchParams, "updated")
          : storedString(stored, "updated"),
    ),
    completed_on: parseListDateFilter(
      saved
        ? filters?.completed_on
        : searchParamString(searchParams, "completed_on") !== ""
          ? searchParamString(searchParams, "completed_on")
          : storedString(stored, "completed_on"),
    ),
    sort: parseListSortKey(
      saved
        ? saved.sort_key
        : searchParamString(searchParams, "sort") !== ""
          ? searchParamString(searchParams, "sort")
          : storedString(stored, "sort"),
    ),
    sortdir:
      searchParamString(searchParams, "sortdir") !== ""
        ? searchParamString(searchParams, "sortdir") === "desc"
          ? "desc"
          : "asc"
        : ((storedString(stored, "sortdir", ["asc", "desc"]) || "asc") as "asc" | "desc"),
    group: parseListGroupBy(
      saved
        ? saved.group_by
        : searchParamString(searchParams, "group") !== ""
          ? searchParamString(searchParams, "group")
          : storedString(stored, "group"),
      statusFieldEnabled,
    ),
    group2:
      parsedGroup2 && (parsedGroup2 !== "section" || rawGroup2 === "section")
        ? parsedGroup2
        : undefined,
    groupdir: saved
      ? filters?.groupdir === "desc"
        ? "desc"
        : "asc"
      : searchParamString(searchParams, "groupdir") !== ""
        ? searchParamString(searchParams, "groupdir") === "desc"
          ? "desc"
          : "asc"
        : ((storedString(stored, "groupdir", ["asc", "desc"]) || "asc") as "asc" | "desc"),
    subtasks_collapsed: saved
      ? filters?.subtasks_collapsed === true
      : searchParamString(searchParams, "subtasks") !== ""
        ? searchParamString(searchParams, "subtasks") === "collapsed"
        : storedBool(stored, "subtasks_collapsed"),
  };
}

export type BoardInitial = {
  hide_completed: boolean;
  completed_only: boolean;
  mine_only: boolean;
  assignee: string;
  status: string;
  due: string;
  start: string;
  creator: string;
  created: string;
  updated: string;
  completed_on: string;
  sort: ListSortKey;
  sortdir: "asc" | "desc";
  show_empty_groups: boolean;
  auto_refresh: boolean;
  show_assignee: boolean;
  show_due: boolean;
  show_status: boolean;
  show_meta: boolean;
};

export function buildBoardInitial({
  searchParams,
  stored,
}: {
  searchParams: SearchParams;
  stored?: ViewState;
}): BoardInitial {
  const sortRaw = searchParamString(searchParams, "sort");
  return {
    hide_completed:
      searchParams.hide !== undefined
        ? searchParamString(searchParams, "hide") === "1"
        : storedBoolDefault(stored, "hide_completed", false),
    completed_only:
      searchParamString(searchParams, "completed") === "done" ||
      storedBoolDefault(stored, "completed_only", false),
    mine_only:
      searchParamString(searchParams, "mine") !== ""
        ? searchParamString(searchParams, "mine") === "1"
        : storedBoolDefault(stored, "mine_only", false),
    assignee: searchOrStored(searchParams, stored, "assignee"),
    status: searchOrStored(searchParams, stored, "status"),
    due: searchOrStored(searchParams, stored, "due", ["overdue", "today", "week", "nextweek", "month"]),
    start: searchOrStored(searchParams, stored, "start"),
    creator: searchOrStored(searchParams, stored, "creator"),
    created: searchOrStored(searchParams, stored, "created"),
    updated: searchOrStored(searchParams, stored, "updated"),
    completed_on: searchOrStored(searchParams, stored, "completed_on"),
    sort: parseListSortKey(sortRaw !== "" ? sortRaw : storedString(stored, "sort")),
    sortdir:
      searchParamString(searchParams, "sortdir") !== ""
        ? searchParamString(searchParams, "sortdir") === "desc"
          ? "desc"
          : "asc"
        : ((storedString(stored, "sortdir", ["asc", "desc"]) || "asc") as "asc" | "desc"),
    show_empty_groups: storedBoolDefault(stored, "show_empty_groups", true),
    auto_refresh: storedBoolDefault(stored, "auto_refresh", true),
    show_assignee: storedBoolDefault(stored, "show_assignee", true),
    show_due: storedBoolDefault(stored, "show_due", true),
    show_status: storedBoolDefault(stored, "show_status", true),
    show_meta: storedBoolDefault(stored, "show_meta", true),
  };
}

export function buildBoardInitialGroup({
  searchParams,
  stored,
  statusFieldEnabled,
}: {
  searchParams: SearchParams;
  stored?: ViewState;
  statusFieldEnabled: boolean;
}): ListGroupBy {
  const groupRaw = searchParamString(searchParams, "group");
  return parseListGroupBy(
    groupRaw !== "" ? groupRaw : storedString(stored, "group"),
    statusFieldEnabled,
  );
}

export type CalendarInitial = {
  completed: "open" | "done" | "";
  assignee: string;
  status: string;
  custom: Record<string, string>;
  due: string;
  created: string;
  updated: string;
  completedOn: string;
  creator: string;
  weekends: boolean;
  multi: boolean;
  color: string;
  weekStart: 0 | 1;
};

const CALENDAR_EXPLICIT_KEYS = [
  "completed",
  "hide",
  "assignee",
  "status",
  "due",
  "created",
  "updated",
  "completed_on",
  "creator",
  "weekends",
  "multi",
  "color",
  "start",
];

/** Calendar restores from persisted state only when the URL carries no filters. */
export function buildCalendarInitial({
  searchParams,
  stored,
}: {
  searchParams: SearchParams;
  stored?: ViewState;
}): CalendarInitial {
  const calendarStored = stored ?? {};
  const calendarExplicit =
    CALENDAR_EXPLICIT_KEYS.some((key) => searchParamString(searchParams, key) !== "") ||
    Object.keys(searchParams).some((key) => key.startsWith("cf_"));
  const calPick = (key: string): string => {
    const urlValue = searchParamString(searchParams, key);
    if (urlValue !== "") return urlValue;
    if (calendarExplicit) return "";
    const value = calendarStored[key];
    return typeof value === "string" ? value : "";
  };
  const calendarBool = (key: string, fallback: boolean): boolean => {
    const urlValue = searchParamString(searchParams, key);
    if (urlValue !== "") return urlValue !== "0";
    if (calendarExplicit) return fallback;
    return typeof calendarStored[key] === "boolean" ? (calendarStored[key] as boolean) : fallback;
  };

  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (key.startsWith("cf_") && typeof value === "string" && value) {
      custom[key.slice(3)] = value;
    }
  }
  if (Object.keys(custom).length === 0 && !calendarExplicit && typeof calendarStored.custom === "string") {
    try {
      const parsed = JSON.parse(calendarStored.custom) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string" && value !== "") custom[key] = value;
        }
      }
    } catch {
      // Ignore malformed persisted filters.
    }
  }

  const completedRaw = searchParamString(searchParams, "completed");
  const completed =
    completedRaw === "open" || completedRaw === "done"
      ? completedRaw
      : searchParamString(searchParams, "hide") === "1"
        ? "open"
        : !calendarExplicit &&
            (calendarStored.completed === "open" || calendarStored.completed === "done")
          ? calendarStored.completed
          : "";
  const assigneeRaw = calPick("assignee");
  const creatorRaw = calPick("creator");
  const dueParam = parseProjectViewSearch(searchParams).dueParam;

  return {
    completed,
    assignee: /^\d+$/.test(assigneeRaw) ? assigneeRaw : assigneeRaw === "none" ? "none" : "",
    status: calPick("status"),
    custom,
    due: calPick("due") || dueParam,
    created: ["today", "7", "30"].includes(calPick("created")) ? calPick("created") : "",
    updated: ["today", "7", "30"].includes(calPick("updated")) ? calPick("updated") : "",
    completedOn: ["today", "7", "30"].includes(calPick("completed_on")) ? calPick("completed_on") : "",
    creator: /^\d+$/.test(creatorRaw) ? creatorRaw : creatorRaw === "none" ? "none" : "",
    weekends: calendarBool("weekends", true),
    multi: calendarBool("multi", true),
    color: calPick("color") || "none",
    weekStart: calPick("start") === "1" ? 1 : 0,
  };
}
