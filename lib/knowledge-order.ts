export { moveListItem as moveKnowledgeId, type RelativePlacement as NotePlacement } from "./list-order";

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
