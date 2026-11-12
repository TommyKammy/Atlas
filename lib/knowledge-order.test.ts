import { test } from "node:test";
import assert from "node:assert/strict";
import { applyKnowledgeOrder, mergeKnowledgeNote, moveKnowledgeId } from "./knowledge-order";

test("moves relative to a target in either direction without disturbing unseen notes", () => {
  assert.deepEqual(moveKnowledgeId([1, 2, 3, 4, 5], 1, 4, "after"), [2, 3, 4, 1, 5]);
  assert.deepEqual(moveKnowledgeId([1, 2, 3, 4, 5], 5, 2, "before"), [1, 5, 2, 3, 4]);
  assert.deepEqual(moveKnowledgeId([1, 2, 3], 2, 2, "after"), [1, 2, 3]);
  assert.throws(() => moveKnowledgeId([1, 2], 3, 1, "before"));
});
test("selection and stale autosave results keep manual positions and update content", () => {
  const notes = [{ id: 1, position: 2, title: "A" }, { id: 2, position: 4, title: "B" }];
  assert.deepEqual(mergeKnowledgeNote(notes, { id: 2, position: 1, title: "edited" }),
    [notes[0], { id: 2, position: 4, title: "edited" }]);
  assert.equal(notes[1].title, "B");
});
test("new or deep-linked notes take their saved position", () => {
  assert.deepEqual(mergeKnowledgeNote([{ id: 1, position: 2 }, { id: 2, position: 8 }], { id: 3, position: 5 }).map(note => note.id), [1, 3, 2]);
});
test("canonical order reconciles a partial list while preserving newer content", () => {
  const notes = [{ id: 2, position: 2, title: "latest" }, { id: 6, position: 6, title: "last" }];
  assert.deepEqual(applyKnowledgeOrder(notes, [1, 6, 3, 4, 2, 5]), [
    { id: 6, position: 2, title: "last" }, { id: 2, position: 5, title: "latest" },
  ]);
});
