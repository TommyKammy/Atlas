import assert from "node:assert/strict";
import { test } from "node:test";
import { criticalPath, type DatedTask } from "./critical-path";

type Dependency = { task_id: number; depends_on_id: number };
const task = (id: number, start_on: string | null, due_on: string | null, is_milestone = false): DatedTask =>
  ({ id, start_on, due_on, is_milestone });
const edge = (from: number, to: number): Dependency => ({ task_id: to, depends_on_id: from });
const ids = (tasks: DatedTask[], deps: Dependency[] = []) => [...criticalPath(tasks, deps)].sort((a, b) => a - b);

test("critical path is empty without any valid due date", () => {
  assert.deepEqual(ids([]), []);
  assert.deepEqual(ids([
    task(1, null, null), task(2, "2026-01-01", null), task(3, null, "invalid"),
  ]), []);
});

test("critical path includes idle time between dependent tasks", () => {
  const tasks = [
    task(1, "2026-01-01", "2026-01-05"),
    task(2, "2026-01-10", "2026-01-11"),
    // A same-deadline competitor beats A+B's seven active days, but not
    // the eleven elapsed days once the dependency gap is included.
    task(3, "2026-01-04", "2026-01-11"),
  ];
  assert.deepEqual(ids(tasks, [edge(1, 2)]), [1, 2]);
});

test("only paths reaching the latest project due date are candidates", () => {
  const tasks = [
    task(1, "2026-01-01", "2026-01-10"),
    task(2, "2026-01-01", "2026-01-10"),
    task(3, null, "2026-01-20"),
  ];
  // Even a long, overlapping early chain cannot replace the final due date.
  assert.deepEqual(ids(tasks, [edge(1, 2)]), [3]);
});

test("latest-date endpoints choose the longest path and retain every tied endpoint", () => {
  const tasks = [
    task(1, "2026-01-01", "2026-01-04"),
    task(2, "2026-01-05", "2026-01-10"),
    task(3, "2026-01-01", "2026-01-10"),
    task(4, "2026-01-08", "2026-01-10"),
  ];
  assert.deepEqual(ids(tasks, [edge(1, 2)]), [1, 2, 3]);
});

test("all equal branches in a diamond are critical regardless of input order", () => {
  const tasks = [
    task(1, "2026-01-01", "2026-01-01"),
    task(2, "2026-01-02", "2026-01-03"),
    task(3, "2026-01-02", "2026-01-03"),
    task(4, "2026-01-04", "2026-01-04"),
  ];
  const deps = [edge(1, 2), edge(1, 3), edge(2, 4), edge(3, 4)];
  assert.deepEqual(ids(tasks, deps), [1, 2, 3, 4]);
  assert.deepEqual(ids([...tasks].reverse(), [...deps].reverse()), [1, 2, 3, 4]);
});

test("disconnected paths of equal length ending on the latest date are all critical", () => {
  const tasks = [
    task(9, "2026-01-01", "2026-01-02"), task(8, "2026-01-04", "2026-01-05"),
    task(4, "2026-01-01", "2026-01-05"),
  ];
  assert.deepEqual(ids(tasks, [edge(9, 8)]), [4, 8, 9]);
});

test("a due-only task is a one-day task while a start-only task is excluded", () => {
  const tasks = [task(1, "2026-01-01", "2026-01-01"), task(2, null, "2026-01-02"), task(3, "2026-12-31", null)];
  assert.deepEqual(ids(tasks, [edge(1, 2), edge(2, 3)]), [1, 2]);
});

test("invalid and reversed ordinary dates cannot change the latest project date", () => {
  const valid = task(1, "2026-01-01", "2026-01-01");
  const invalid = [
    task(2, null, "2026-02-30"), task(3, null, "2026-13-01"),
    task(4, null, "2026-01-01T12:00:00Z"), task(5, null, "2026-1-2"),
    task(6, "invalid", "2026-12-31"), task(7, "2027-01-01", "2026-12-31"),
  ];
  assert.deepEqual(ids([valid, ...invalid], invalid.map(({ id }) => edge(id, 1))), [1]);
});

test("calendar durations cover leap day and year boundaries without local timezone shifts", () => {
  const tasks = [
    task(1, "2024-02-28", "2024-02-29"), task(2, "2024-03-01", "2024-03-01"),
    task(3, "2024-02-28", "2024-03-01"),
  ];
  assert.deepEqual(ids(tasks, [edge(1, 2)]), [1, 2, 3]);
  assert.deepEqual(ids([
    task(1, "2026-12-31", "2026-12-31"), task(2, "2027-01-01", "2027-01-01"),
    task(3, "2026-12-31", "2027-01-01"),
  ], [edge(1, 2)]), [1, 2, 3]);
});

test("milestone weight ignores a leftover start date, including invalid legacy values", () => {
  const makeTasks = (start: string | null) => [
    task(1, start, "2026-01-20", true),
    task(2, "2026-01-21", "2026-01-22"),
    task(3, "2026-01-19", "2026-01-22"),
  ];
  for (const start of [null, "2026-01-01", "2026-01-20", "invalid", "2026-12-31"]) {
    assert.deepEqual(ids(makeTasks(start), [edge(1, 2)]), [3], `milestone start ${start}`);
  }
});

test("same-day milestone dependencies do not add an artificial day", () => {
  const tasks = [
    task(1, "2026-01-01", "2026-01-01"), task(2, null, "2026-01-01", true),
    task(3, "2026-01-02", "2026-01-02"), task(4, "2026-01-01", "2026-01-02"),
  ];
  assert.deepEqual(ids(tasks, [edge(1, 2), edge(2, 3)]), [1, 2, 3, 4]);
  assert.deepEqual(ids([
    task(1, "2026-01-03", "2026-01-03"), task(2, null, "2026-01-03", true),
    task(3, "2026-01-02", "2026-01-03"),
  ], [edge(1, 2)]), [3]);
});

test("a milestone-only project retains every latest zero-duration endpoint", () => {
  assert.deepEqual(ids([
    task(1, null, "2026-01-01", true), task(2, null, "2026-01-02", true),
    task(3, null, "2026-01-02", true),
  ]), [2, 3]);
});

test("any cycle in the eligible project graph suppresses critical-path highlighting", () => {
  const tasks = [task(1, null, "2026-01-01"), task(2, null, "2026-01-02"), task(3, null, "2026-02-01")];
  assert.deepEqual(ids(tasks, [edge(1, 2), edge(2, 1)]), []);
  assert.deepEqual(ids(tasks, [edge(1, 1)]), []);
});

test("out-of-project and undated dependency endpoints are ignored without mutation", () => {
  const tasks = [task(1, null, "2026-01-01"), task(2, null, "2026-01-02"), task(3, null, null)];
  const deps = [edge(1, 2), edge(99, 1), edge(2, 98), edge(3, 1), edge(3, 3), edge(1, 2)];
  const before = structuredClone({ tasks, deps });
  assert.deepEqual(ids(tasks, deps), [1, 2]);
  assert.deepEqual({ tasks, deps }, before);
});

test("deep dependency chains are iterative and do not exhaust the JavaScript stack", () => {
  const count = 12_000;
  const tasks = Array.from({ length: count }, (_, i) => task(i + 1, null, "2026-01-01"));
  const deps = Array.from({ length: count - 1 }, (_, i) => edge(i + 1, i + 2));
  const result = criticalPath(tasks, deps);
  assert.equal(result.size, count);
  assert.ok(result.has(1));
  assert.ok(result.has(count));
});

// Independent, deliberately slow oracle: enumerate every root-to-end path in
// small DAGs, score complete paths, then union all tied winners at the deadline.
// This exercises joins/ties without duplicating the production dynamic program.
function exhaustiveReference(tasks: DatedTask[], deps: Dependency[]): number[] {
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
  const nodes = new Map(tasks.map((t) => {
    const due = day(t.due_on!);
    return [t.id, { start: t.is_milestone ? due + 1 : day(t.start_on ?? t.due_on!), finish: due + 1,
      due, duration: t.is_milestone ? 0 : due - day(t.start_on ?? t.due_on!) + 1 }];
  }));
  const pathsTo = (id: number): number[][] => {
    const predecessors = deps.filter((d) => d.task_id === id).map((d) => d.depends_on_id);
    return predecessors.length === 0 ? [[id]] : predecessors.flatMap((p) => pathsTo(p).map((path) => [...path, id]));
  };
  const deadline = Math.max(...[...nodes.values()].map((n) => n.due));
  const paths = tasks.filter((t) => nodes.get(t.id)!.due === deadline).flatMap((t) => pathsTo(t.id));
  const weighted = paths.map((path) => ({ path, score: path.reduce((sum, id, index) => {
    const current = nodes.get(id)!;
    const previous = index === 0 ? null : nodes.get(path[index - 1])!;
    return sum + current.duration + (previous ? Math.max(0, current.start - previous.finish) : 0);
  }, 0) }));
  const longest = Math.max(...weighted.map((p) => p.score));
  return [...new Set(weighted.filter((p) => p.score === longest).flatMap((p) => p.path))].sort((a, b) => a - b);
}

test("all four-node DAG edge combinations match independently enumerated paths", () => {
  const patterns = [
    [task(1, "2026-01-01", "2026-01-02"), task(2, "2026-01-05", "2026-01-06"),
      task(3, "2026-01-02", "2026-01-05"), task(4, "2026-01-07", "2026-01-07")],
    [task(1, null, "2026-01-01"), task(2, null, "2026-01-01", true),
      task(3, "2026-01-02", "2026-01-02"), task(4, "2026-01-01", "2026-01-02")],
    [task(1, "2026-01-01", "2026-01-08"), task(2, "2026-01-02", "2026-01-05"),
      task(3, "2026-01-03", "2026-01-08"), task(4, null, "2026-01-08", true)],
  ];
  const possibleEdges = [edge(1, 2), edge(1, 3), edge(1, 4), edge(2, 3), edge(2, 4), edge(3, 4)];
  for (const [pattern, tasks] of patterns.entries()) {
    for (let bits = 0; bits < 1 << possibleEdges.length; bits++) {
      const deps = possibleEdges.filter((_, bit) => bits & (1 << bit));
      const expected = exhaustiveReference(tasks, deps);
      assert.deepEqual(ids(tasks, deps), expected, `pattern ${pattern}, edge mask ${bits}`);
      assert.deepEqual(ids([...tasks].reverse(), [...deps].reverse()), expected, `reversed pattern ${pattern}, edge mask ${bits}`);
    }
  }
});
