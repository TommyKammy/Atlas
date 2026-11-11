/** Personal ordering is separate from shared task dates and optimistic versions. */
export const MY_TASK_LEGACY_ITEM_LIMIT = 500;
export const MY_TASK_MOVE_TASK_LIMIT = 10_000;

export type MyTaskMove = {
  task_id: number;
  before_task_id?: number;
  after_task_id?: number;
};

export type MyTaskOrderItem = {
  task_id: number;
  position: number;
  /** A legacy snapshot assertion only. This route never writes task dates. */
  due_on?: string | null;
};

export type MyTaskOrderRequest =
  | { kind: "move"; move: MyTaskMove }
  | { kind: "items"; items: MyTaskOrderItem[] };

export type MyTaskSnapshotItem = { task_id: number; due_on: string | null; updated_at: string };
export type MyTaskSnapshot = { items: MyTaskSnapshotItem[]; overflow: boolean };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isoDay(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function parseMyTaskOrderRequest(value: unknown):
  { ok: true; value: MyTaskOrderRequest } | { ok: false; error: string } {
  const body = record(value);
  if (!body) return { ok: false, error: "invalid request" };
  if ("move" in body) {
    if (Object.keys(body).some((key) => key !== "move")) return { ok: false, error: "move cannot be combined with other fields" };
    const move = record(body.move);
    if (!move || Object.keys(move).some((key) => !["task_id", "before_task_id", "after_task_id"].includes(key)) ||
        !positiveId(move.task_id) ||
        ("before_task_id" in move && !positiveId(move.before_task_id)) ||
        ("after_task_id" in move && !positiveId(move.after_task_id)) ||
        ("before_task_id" in move && "after_task_id" in move) ||
        move.before_task_id === move.task_id || move.after_task_id === move.task_id) {
      return { ok: false, error: "invalid move" };
    }
    return { ok: true, value: { kind: "move", move: { ...move } as MyTaskMove } };
  }
  if (Object.keys(body).some((key) => key !== "items") || !Array.isArray(body.items) ||
      body.items.length === 0 || body.items.length > MY_TASK_LEGACY_ITEM_LIMIT) {
    return { ok: false, error: `items (1-${MY_TASK_LEGACY_ITEM_LIMIT}) or a move are required` };
  }
  const items: MyTaskOrderItem[] = [];
  const seen = new Set<number>();
  for (const raw of body.items) {
    const item = record(raw);
    if (!item || Object.keys(item).some((key) => !["task_id", "position", "due_on"].includes(key)) ||
        !positiveId(item.task_id) || typeof item.position !== "number" ||
        !Number.isFinite(item.position) || Math.abs(item.position) > Number.MAX_SAFE_INTEGER ||
        ("due_on" in item && !isoDay(item.due_on)) || seen.has(item.task_id)) {
      return { ok: false, error: "invalid item" };
    }
    seen.add(item.task_id);
    items.push({ task_id: item.task_id, position: item.position,
      ...("due_on" in item ? { due_on: item.due_on as string | null } : {}) });
  }
  return { ok: true, value: { kind: "items", items } };
}

/** Relative intent composes with another tab's current order; no full-list DTO. */
export function applyMyTaskMove(ids: number[], move: MyTaskMove): number[] {
  const anchor = move.before_task_id ?? move.after_task_id;
  if (!ids.includes(move.task_id) || (anchor !== undefined && !ids.includes(anchor))) {
    throw new Error("task eligibility changed");
  }
  const next = ids.filter((id) => id !== move.task_id);
  const target = anchor === undefined ? next.length : next.indexOf(anchor) + (move.after_task_id === undefined ? 0 : 1);
  next.splice(target, 0, move.task_id);
  return next;
}

export function myTaskOrderEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function parseMyTaskSnapshot(value: unknown): MyTaskSnapshot {
  const body = record(value);
  if (!body || !Array.isArray(body.items) || typeof body.overflow !== "boolean" || body.items.length > MY_TASK_MOVE_TASK_LIMIT + 1) {
    throw new Error("invalid My Tasks snapshot");
  }
  const seen = new Set<number>();
  const items = body.items.map((raw): MyTaskSnapshotItem => {
    const item = record(raw);
    if (!item || !positiveId(item.task_id) || !isoDay(item.due_on) ||
        typeof item.updated_at !== "string" || item.updated_at === "" || seen.has(item.task_id)) {
      throw new Error("invalid My Tasks snapshot item");
    }
    seen.add(item.task_id);
    return { task_id: item.task_id, due_on: item.due_on, updated_at: item.updated_at };
  });
  return { items, overflow: body.overflow };
}
