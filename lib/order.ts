/** Null means there is no representable rank in this gap. */
export function positionBetween(previous: number | null, next: number | null): number | null {
  let position = 1000;
  if (previous !== null && next !== null) position = previous / 2 + next / 2;
  else if (previous !== null) position = previous + 1000;
  else if (next !== null) position = next - 1000;

  return Number.isFinite(position) && (previous === null || previous < position) &&
    (next === null || position < next) ? position : null;
}

export type TaskPlacement = { project_id: number; anchor_id: number | null; side: "before" | "after" };

type RankedTask = { id: number; position: number };

/** Make room around an exhausted gap, leaving ranks outside the window untouched. */
export function spaceTaskRanks(peers: RankedTask[], index: number, movedId: number): RankedTask[] {
  for (let radius = 1; ; radius *= 2) {
    const start = Math.max(0, index - radius);
    const end = Math.min(peers.length, index + radius);
    const lower = peers[start - 1]?.position;
    const upper = peers[end]?.position;
    const count = end - start + 1;
    const step = lower !== undefined && upper !== undefined ? (upper - lower) / (count + 1) : 1000;
    const base = lower ?? (upper === undefined ? 0 : upper - step * (count + 1));
    const ids = peers.slice(start, end).map(task => task.id);
    ids.splice(index - start, 0, movedId);
    const ranks = ids.map((id, i) => ({ id, position: base + step * (i + 1) }));
    if (step >= 1 && ranks.every(({ position }, i) => Number.isFinite(position) &&
        position > (ranks[i - 1]?.position ?? lower ?? -Infinity)) &&
        ranks[count - 1].position < (upper ?? Infinity)) {
      return ranks;
    }
    // With no outside bounds the entire run gets ordinary 1000-spaced ranks.
  }
}
