import { test } from "node:test";
import assert from "node:assert/strict";
import { preparePartnerContext, parsePartnerOutput, partnerPlainText } from "./project-partner";
import type { PartnerSnapshot } from "./services/authorized-project-context";

const snapshot: PartnerSnapshot = { project: { id: 1, name: "確認", description: "説明", status: "active" },
  note: { id: 2, title: "会議", body: "田中さんが金曜日までに計画を確認する。", body_doc: null, revision: 0, updated_at: "2026-11-13" }, tasks: [], notes: [], comments: [], dependencies: [], totals: { notes: 0, comments: 0, dependencies: 0 } };
const at = "2026-11-13T00:00:00.000Z";
const context = preparePartnerContext(snapshot, "action_extract", at, 20000);
const output = { summary: "提案", sections: [{ heading: "決定事項", items: [{ text: "計画の確認", source_ids: ["N2"] }] }], actions: [{ title: "計画を確認", assignee: "田中", due: "金曜日", evidence: snapshot.note!.body, source_id: "N2" }], questions: [] };
test("action context is selected-note only, bounded, URL-free and dated", () => {
  assert.equal(context.period_start, "2026-11-06T00:00:00.000Z");
  assert.equal(JSON.parse(context.input).facts_source_id, null);
  assert.deepEqual(context.sources.map(s => s.id), ["N2"]);
  assert.equal(context.coverage.partial, false);
  assert.throws(() => preparePartnerContext(snapshot, "action_extract", at, 100), { status: 400 });
  const linked = preparePartnerContext({ ...snapshot, note: { ...snapshot.note!, body: "参照 https://example.invalid/secret" } }, "action_extract", at, 20000);
  assert.ok(!linked.input.includes("example.invalid"));
});
test("actions need real contiguous evidence and explicit owner/date; no fabricated sources", () => {
  assert.deepEqual(parsePartnerOutput(JSON.stringify(output), context, "action_extract"), output);
  const fabricated = { ...output, actions: [{ ...output.actions[0], assignee: "佐藤", due: "2026-11-20" }] };
  assert.equal(parsePartnerOutput(JSON.stringify(fabricated), context, "action_extract").actions[0].due, null);
  assert.equal(parsePartnerOutput(JSON.stringify(fabricated), context, "action_extract").actions[0].assignee, null);
  for (const invalid of ["garbage", JSON.stringify({ ...output, actions: [{ ...output.actions[0], evidence: "勝手な仕事を実行する" }] }), JSON.stringify({ ...output, sections: [{ heading: "a", items: [{ text: "b", source_ids: ["N404"] }] }] })]) assert.throws(() => parsePartnerOutput(invalid, context, "action_extract"), { status: 502 });
  assert.throws(() => parsePartnerOutput(JSON.stringify(output), context, "weekly_report"), { status: 502 });
});
test("partial project coverage is disclosed and copy retains evidence and period", () => {
  const project = { ...snapshot, note: undefined, facts: { total: 99, completed: 10, overdue: 4, unassigned: 3, without_due: 0, inactive: 2, completed_in_period: 2, created_in_period: 1, updated_in_period: 3, due_next_week: 5, version: "private-hash" } };
  const c = preparePartnerContext(project, "weekly_report", at, 20000);
  assert.equal(c.coverage.partial, true); assert.ok(!c.input.includes("private-hash"));
  const copied = partnerPlainText({ ...output, actions: [], ...c, skill: "weekly_report" });
  assert.match(copied, /対象期間/); assert.match(copied, /参照は一部/); assert.match(copied, /参照元/);
});
test("placement suggestions only accept section IDs supplied in bounded project context", () => {
  const c = preparePartnerContext({ ...snapshot, sections: [{ id: 7, name: "設計" }] }, "action_extract", at, 20000);
  assert.deepEqual(JSON.parse(c.input).placement_sections, [{ id: 7, name: "設計" }]);
  assert.deepEqual(c.sources.map(s => s.id), ["N2"]);
  const proposed = { ...output, actions: [{ ...output.actions[0], section_id: 7, section_reason: "設計の計画を確認するため" }] };
  assert.equal(parsePartnerOutput(JSON.stringify(proposed), c, "action_extract").actions[0].section_id, 7);
  for (const id of ["7", 999, null]) {
    const invalid = { ...proposed, actions: [{ ...proposed.actions[0], section_id: id }] };
    assert.equal(parsePartnerOutput(JSON.stringify(invalid), c, "action_extract").actions[0].section_id, undefined);
  }
  const crowded = preparePartnerContext({ ...snapshot, sections: Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: "設計".repeat(100) })) }, "action_extract", at, 1600);
  assert.ok(crowded.input.length <= 1600); assert.ok(crowded.section_ids!.length < 100); assert.equal(crowded.coverage.notes, 1);
});
