/** A relative section anchor; omitting both means "append at the end". */
export type SectionAnchor = { before?: number; after?: number };

export type SectionRankRow = { id: number; position: number };

/**
 * Insertion index for `rows`, which must already be in display order.
 * An unknown anchor falls back to the end so a stale menu cannot lose data.
 */
export function sectionInsertionIndex(rows: SectionRankRow[], anchor: SectionAnchor | null): number {
  if (!anchor) return rows.length;
  if (anchor.before !== undefined) {
    const index = rows.findIndex((row) => row.id === anchor.before);
    return index >= 0 ? index : rows.length;
  }
  if (anchor.after !== undefined) {
    const index = rows.findIndex((row) => row.id === anchor.after);
    return index >= 0 ? index + 1 : rows.length;
  }
  return rows.length;
}

/**
 * Integer rank strictly between the neighbours. Existing sections use a
 * 1000-step grid, so a dense pair eventually has no integer gap and the
 * caller renumbers the project instead of drifting into fractions.
 */
export function sectionPositionBetween(
  previous: number | null,
  next: number | null,
): number | null {
  let position: number;
  if (previous !== null && next !== null) position = Math.floor((previous + next) / 2);
  else if (previous !== null) position = previous + 1000;
  else if (next !== null) position = next - 1000;
  else position = 1000;

  return Number.isFinite(position) && (previous === null || previous < position) &&
    (next === null || position < next)
    ? position
    : null;
}

/** Restore a 1000-step grid while preserving the supplied display order. */
export function sectionRenumber(rows: SectionRankRow[]): { id: number; position: number }[] {
  return rows.map((row, index) => ({ id: row.id, position: (index + 1) * 1000 }));
}
