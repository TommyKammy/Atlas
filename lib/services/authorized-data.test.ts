import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readKnowledge, readKnowledgeHistory, listKnowledge, listKnowledgeTrash, getProjectKnowledge,
  searchTasksAdvanced, searchProjectsGlobal, searchMessagesGlobal, searchKnowledgeGlobal, searchFilesGlobal,
  getSearchCustomFields, type DataActor,
} from "./authorized-data";
import type { AdvancedSearchFilters } from "../repositories/search";
import { db } from "../db";

test("all read entry points reject missing/invalid actors before touching the database, even for empty searches", async t => {
  const query = t.mock.method(db, "query", async () => { throw new Error("database must not be reached"); });
  const filters = { q: "" } as AdvancedSearchFilters;
  for (const actor of [undefined, null, {}, { userId: 0 }, { userId: -1 }, { userId: NaN }, { userId: "1" }] as unknown as DataActor[]) {
    const reads = [
      () => readKnowledge(1, actor), () => readKnowledgeHistory(1, actor),
      () => listKnowledge(1, actor), () => listKnowledgeTrash(1, actor), () => getProjectKnowledge(1, actor),
      () => searchTasksAdvanced(1, filters, actor), () => searchProjectsGlobal(1, "", actor),
      () => searchMessagesGlobal(1, "", actor), () => searchKnowledgeGlobal(1, "", actor),
      () => searchFilesGlobal(1, "", actor), () => getSearchCustomFields(1, actor),
    ];
    for (const read of reads) await assert.rejects(read, { status: 401 });
  }
  assert.equal(query.mock.callCount(), 0);
});

// Keep the permission boundary mandatory for TypeScript consumers as well.
function typeContract() {
  // @ts-expect-error an authenticated actor is required
  void readKnowledge(1);
  // @ts-expect-error searches cannot opt out of authorization
  void searchKnowledgeGlobal(1, "note");
}
void typeContract;
