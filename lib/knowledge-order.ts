export type NotePlacement = "before" | "after";

/** Relative intent keeps unseen pages and unrelated concurrent moves intact. */
export function moveKnowledgeId(order: number[], id: number, targetId: number, placement: NotePlacement): number[] {
  if (!order.includes(id) || !order.includes(targetId)) throw new Error("ノートが見つかりません");
  if (id === targetId) return order;
  const next = order.filter(value => value !== id);
  next.splice(next.indexOf(targetId) + (placement === "after" ? 1 : 0), 0, id);
  return next;
}

export function applyKnowledgeOrder<T extends { id: number; position: number }>(items: T[], order: number[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index + 1]));
  return items.map(item => rank.has(item.id) ? { ...item, position: rank.get(item.id)! } : item)
    .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

/** Updating/reading a note must never change its position in the visible list. */
export function mergeKnowledgeNote<T extends { id: number; position: number }>(items: T[], note: T): T[] {
  if (items.some(item => item.id === note.id)) return items.map(item => item.id === note.id ? { ...note, position: item.position } : item);
  return [...items, note].sort((a, b) => a.position - b.position || a.id - b.id);
}
