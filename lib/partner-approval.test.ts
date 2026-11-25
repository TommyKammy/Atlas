import { test } from "node:test";
import assert from "node:assert/strict";
import { validateApproval } from "./partner-approval";
import { explicitActionDate, matchActionAssignee, suggestActionDate, suggestActionFields } from "./partner-workflows";

const selection = { index: 0, title: "確認する", assignee_id: 2, due_on: "2028-02-29", section_id: null };
const body = { batch_id: "00000000-0000-4000-8000-000000000001", confirmed: true, actions: [selection] };
test("approval requires explicit confirmation, selected candidates, real dates and assigned users", () => {
  assert.deepEqual(validateApproval(body).actions, [selection]);
  for (const value of [{ ...body, confirmed: false }, { ...body, actions: [] }, { ...body, model: "override" }, { ...body, actions: [selection, selection] },
    ...[{ due_on: "金曜日" }, { due_on: "2027-02-29" }, { due_on: "0000-01-01" }, { assignee_id: null }, { assignee_id: "2" }, { index: -1 }, { section_id: -1 }, { title: " " }, { task_id: 3 }].map(change => ({ ...body, actions: [{ ...selection, ...change }] }))]) {
    assert.throws(() => validateApproval(value), { status: 400 });
  }
});
test("approval dates remain strict and ambiguous assignees stay unselected", () => {
  assert.equal(explicitActionDate("2028-02-29"), "2028-02-29");
  for (const v of ["金曜日", "明日", "2027-02-29", "2026-04-31", null]) assert.equal(explicitActionDate(v), "");
  const members = [{ id: 2, name: "田中" }, { id: 3, name: "田中" }, { id: 4, name: "佐藤" }];
  assert.equal(matchActionAssignee("田中", members), "");
  assert.equal(matchActionAssignee("田中さん", members), "");
  assert.equal(matchActionAssignee("佐藤", members), "4");
});
test("assignee suggestions resolve honorifics and unique family names without choosing between namesakes", () => {
  const members = [{ id: 2, name: "田中 太郎" }, { id: 3, name: "田中 花子" }, { id: 4, name: "佐藤 花子" }];
  assert.equal(matchActionAssignee("佐藤さん", members), "4");
  assert.equal(matchActionAssignee("佐藤　花子 様", members), "4");
  assert.equal(matchActionAssignee("田中さん", members), "");
  assert.equal(matchActionAssignee("田中太郎", members), "2");
  assert.equal(matchActionAssignee("佐", members), "");
  assert.equal(matchActionAssignee("鈴木さん", members), "");
});
test("date suggestions use a stable Japanese extraction day and explicit week semantics", () => {
  // UTC Friday is already Saturday in Japan.
  const at = "2026-11-13T16:00:00.000Z";
  for (const [input, date] of [["月曜日", "2026-11-16"], ["土曜日まで", "2026-11-14"], ["今週の金曜日", "2026-11-13"], ["来週の月曜日", "2026-11-16"], ["再来週の金曜日", "2026-11-27"], ["明日までに", "2026-11-15"], ["明後日", "2026-11-16"], ["3日後", "2026-11-17"], ["2026年12月1日", "2026-12-01"], ["１２月１日", "2026-12-01"], ["1/5", "2027-01-05"]]) {
    assert.equal(suggestActionDate(input, at).date, date, input);
  }
  assert.match(suggestActionDate("月曜日", at).reason, /2026-11-14.*日本時間/);
  assert.equal(suggestActionDate("来週の月曜日", "2026-11-15T03:00:00Z").date, "2026-11-16");
  assert.equal(suggestActionDate("月曜日", "2026-11-16T03:00:00Z").date, "2026-11-16");
  for (const input of ["なるべく早く", "月末", "来週", "月曜日か火曜日", "2026年2月30日", "2/30", "2026-02-29", "", null]) assert.equal(suggestActionDate(input, at).date, "", String(input));
  assert.equal(suggestActionDate("明日", "invalid").date, "");
});
test("a yearless leap day has a reason only when a date can be suggested", () => {
  // Across midnight in Japan the candidate changes from today to next year.
  const leapDay = suggestActionDate("2月29日", "2024-02-29T14:59:59Z");
  assert.equal(leapDay.date, "2024-02-29");
  assert.match(leapDay.reason, /次に来る日付/);
  assert.deepEqual(suggestActionDate("2月29日", "2024-02-29T15:00:00Z"), { date: "", reason: "" });
});
test("section suggestions use existing sections only, retain model reasoning, and degrade safely for old batches", () => {
  const sections = [{ id: 1, name: "未着手" }, { id: 2, name: "広報" }];
  const action = { title: "公開告知をまとめる", assignee: "佐藤さん", due: "月曜日", evidence: "佐藤さんが月曜日までに公開告知をまとめる。", source_id: "N1", section_id: 2, section_reason: "告知文を準備する仕事のため" };
  const s = suggestActionFields(action, [{ id: 4, name: "佐藤 花子" }], sections, "2026-11-14T00:00:00Z");
  assert.equal(s.assignee_id, 4); assert.equal(s.due_on, "2026-11-16"); assert.equal(s.section_id, 2); assert.equal(s.section_reason, action.section_reason);
  assert.equal(suggestActionFields({ ...action, section_id: 999 }, [], sections, "2026-11-14").section_id, 1);
  assert.equal(suggestActionFields(action, [], [], "2026-11-14").section_id, null);
  const named = suggestActionFields({ ...action, evidence: "未着手のセクションに追加する。" }, [], sections, "2026-11-14");
  assert.equal(named.section_id, 1); assert.match(named.section_reason, /明記/);
  assert.equal(suggestActionFields({ ...action, section_id: undefined }, [], [{ id: 3, name: "検証" }, { id: 4, name: "設計" }], "2026-11-14").section_id, null);
});
