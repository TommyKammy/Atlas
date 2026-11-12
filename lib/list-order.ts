export type RelativePlacement = "before" | "after";

/** Move one item relative to another without replacing unrelated ordering. */
export function moveListItem(order: number[], id: number, targetId: number, placement: RelativePlacement): number[] {
  if (!order.includes(id) || !order.includes(targetId)) throw new Error("項目が見つかりません");
  if (id === targetId) return order;
  const next = order.filter(value => value !== id);
  next.splice(next.indexOf(targetId) + (placement === "after" ? 1 : 0), 0, id);
  return next;
}

/** Use current objects, drop removed IDs and append newly visible items. */
export function orderByIds<T extends { id: number }>(items: T[], order: number[]): T[] {
  const remaining = new Map(items.map(item => [item.id, item]));
  const sorted: T[] = [];
  for (const id of order) {
    const item = remaining.get(id);
    if (item) { sorted.push(item); remaining.delete(id); }
  }
  return [...sorted, ...remaining.values()];
}
