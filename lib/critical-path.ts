// Critical-path computation over dated tasks (pure, unit-tested).
// Duration of a task = inclusive day span; undated tasks are excluded.
// Returns the set of task ids on one longest dependency chain.
// Ties resolve to the chain whose terminal task has the smallest id.

export type DatedTask = {
  id: number;
  start_on: string | null;
  due_on: string | null;
};

const DAY = 86400000;

function dayNum(s: string): number | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.floor(t / DAY);
}

export function criticalPath(
  tasks: DatedTask[],
  deps: { task_id: number; depends_on_id: number }[],
): Set<number> {
  const dated = tasks.filter((t) => dayNum(t.start_on ?? "") !== null || dayNum(t.due_on ?? "") !== null);
  const dur = new Map<number, number>();
  for (const t of dated) {
    const s = dayNum(t.start_on ?? "") ?? dayNum(t.due_on ?? "")!;
    const e = dayNum(t.due_on ?? "") ?? dayNum(t.start_on ?? "")!;
    dur.set(t.id, Math.max(1, e - s + 1));
  }
  const preds = new Map<number, number[]>();
  for (const t of dated) preds.set(t.id, []);
  for (const d of deps) {
    if (preds.has(d.task_id) && dur.has(d.depends_on_id) && d.task_id !== d.depends_on_id) {
      preds.get(d.task_id)!.push(d.depends_on_id);
    }
  }
  const memo = new Map<number, number>();
  const visiting = new Set<number>();
  const dist = (id: number): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return dur.get(id)!; // cycle guard
    visiting.add(id);
    let best = 0;
    let bestPred = -1;
    for (const p of preds.get(id) ?? []) {
      const v = dist(p);
      if (v > best || (v === best && p < bestPred)) {
        best = v;
        bestPred = p;
      }
    }
    visiting.delete(id);
    void bestPred;
    const total = best + (dur.get(id) ?? 0);
    memo.set(id, total);
    return total;
  };
  let end = -1;
  let bestTotal = 0;
  for (const t of dated) {
    const v = dist(t.id);
    if (v > bestTotal || (v === bestTotal && (end === -1 || t.id < end))) {
      bestTotal = v;
      end = t.id;
    }
  }
  const path = new Set<number>();
  let cur: number | undefined = end === -1 ? undefined : end;
  while (cur !== undefined && !path.has(cur)) {
    path.add(cur);
    let next: number | undefined;
    let best = -1;
    for (const p of preds.get(cur) ?? []) {
      const v = memo.get(p) ?? 0;
      if (v > best || (v === best && (next === undefined || p < next))) {
        best = v;
        next = p;
      }
    }
    cur = next;
  }
  return path;
}
