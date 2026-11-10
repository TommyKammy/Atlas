/**
 * Date-aware critical paths ending at the project's latest due date.
 * Includes calendar gaps and every tied longest path, not just one ID-based tie.
 * Call with the complete project graph, before display filters or date windows.
 */
export type DatedTask = {
  id: number;
  start_on: string | null;
  due_on: string | null;
  is_milestone?: boolean;
};

type PathNode = {
  id: number;
  due: number;
  start: number;
  finish: number;
  duration: number;
  pending: number;
  predecessorIds: Set<number>;
  successors: PathNode[];
  bestPredecessors: PathNode[];
  score: number;
};

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Strict UTC date parsing: Date.parse alone normalizes dates such as Feb 30. */
function dayNumber(value: string | null, cache: Map<string, number | null>): number | null {
  if (typeof value !== "string") return null;
  if (cache.has(value)) return cache.get(value)!;
  let day: number | null = null;
  if (ISO_DAY.test(value) && value.slice(0, 4) !== "0000") {
    const time = Date.parse(`${value}T00:00:00Z`);
    if (Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value) {
      day = time / DAY_MS;
    }
  }
  cache.set(value, day);
  return day;
}

export function criticalPath(
  tasks: DatedTask[],
  deps: { task_id: number; depends_on_id: number }[],
): Set<number> {
  const dates = new Map<string, number | null>();
  const nodes = new Map<number, PathNode>();
  let latestDue = Number.NEGATIVE_INFINITY;
  for (const task of tasks) {
    const due = dayNumber(task.due_on, dates);
    // A due date is required. A start-only task cannot define project completion.
    if (due === null) continue;
    // A milestone is an end-of-day event with zero duration. Its old start date
    // may remain after conversion and must not contribute work or waiting time.
    const finish = due + 1;
    const start = task.is_milestone
      ? finish
      : task.start_on == null ? due : dayNumber(task.start_on, dates);
    if (start === null || start > finish || (!task.is_milestone && start > due)) continue;
    nodes.set(task.id, {
      id: task.id, due, start, finish, duration: finish - start,
      pending: 0, predecessorIds: new Set(), successors: [],
      bestPredecessors: [], score: Number.NEGATIVE_INFINITY,
    });
    latestDue = Math.max(latestDue, due);
  }
  if (nodes.size === 0) return new Set<number>();

  for (const edge of deps) {
    const node = nodes.get(edge.task_id);
    const predecessor = nodes.get(edge.depends_on_id);
    if (!node || !predecessor || node.predecessorIds.has(predecessor.id)) continue;
    node.predecessorIds.add(predecessor.id);
    node.pending += 1;
    predecessor.successors.push(node);
  }

  const queue: PathNode[] = [];
  for (const node of nodes.values()) {
    // Edge deduplication is finished; retain only the incoming-edge count.
    node.predecessorIds.clear();
    if (node.pending === 0) {
      node.score = node.duration;
      queue.push(node);
    }
  }

  // Kahn's traversal is linear and cannot overflow the JS call stack on a long
  // chain. Overlapping scheduled tasks have no positive gap; their work still
  // contributes to the dependency chain instead of being silently discarded.
  for (let index = 0; index < queue.length; index += 1) {
    const predecessor = queue[index];
    for (const node of predecessor.successors) {
      const gap = Math.max(0, node.start - predecessor.finish);
      const score = predecessor.score + gap + node.duration;
      if (score > node.score) {
        node.score = score;
        node.bestPredecessors.length = 0;
        node.bestPredecessors.push(predecessor);
      } else if (score === node.score) {
        node.bestPredecessors.push(predecessor);
      }
      node.pending -= 1;
      if (node.pending === 0) queue.push(node);
    }
  }
  // A cyclic dated graph has no valid critical path; never invent one by
  // breaking a cycle at a task or publishing a partial acyclic component.
  if (queue.length !== nodes.size) return new Set<number>();

  let longest = Number.NEGATIVE_INFINITY;
  const ends: PathNode[] = [];
  for (const node of nodes.values()) {
    if (node.due !== latestDue) continue;
    if (node.score > longest) {
      longest = node.score;
      ends.length = 0;
      ends.push(node);
    } else if (node.score === longest) {
      ends.push(node);
    }
  }

  const critical = new Set<number>();
  while (ends.length > 0) {
    const node = ends.pop()!;
    if (critical.has(node.id)) continue;
    critical.add(node.id);
    for (const predecessor of node.bestPredecessors) ends.push(predecessor);
  }
  return critical;
}
