import assert from "node:assert/strict";
import { test } from "node:test";
import { formCardMeta, formStatusLabel } from "./forms-presentation";

test("formStatusLabel always pairs the published state with a word", () => {
  assert.equal(formStatusLabel(true), "公開中");
  assert.equal(formStatusLabel(false), "下書き");
});

test("formCardMeta keeps the muted field and response summary readable", () => {
  assert.equal(formCardMeta(3, 12), "3 項目 ・ 回答 12 件");
  assert.equal(formCardMeta(0, 0), "0 項目 ・ 回答 0 件");
});
