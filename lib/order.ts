// Fractional position math for drag-reorder (shared, unit-tested).
export function positionBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1000;
  if (prev === null) return next! - 1000;
  if (next === null) return prev + 1000;
  if (next - prev < 0.0001) return prev + 1000;
  return (prev + next) / 2;
}
