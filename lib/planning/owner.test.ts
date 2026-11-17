import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import type { Queryable } from "../db";
import {
  planInitiativeOwnerChange,
  resolveActiveInitiativeOwner,
} from "./owner";
import {
  parseNullableOwnerMemberId,
  parseOwnerMemberId,
  parseOwnerNameHint,
} from "./validation";

function queryReturning(rowCount: number, rows: Record<string, unknown>[] = []): Queryable {
  return {
    query: async () => ({ rowCount, rows }) as never,
  };
}

test("legacy free-text owners are retained byte-for-byte on unrelated saves", () => {
  const existing = { ownerMemberId: null, ownerName: "  佐藤（旧入力）  " };

  assert.deepEqual(planInitiativeOwnerChange(existing, null), {
    mode: "keep",
    ownerMemberId: null,
    ownerName: "  佐藤（旧入力）  ",
  });
  assert.deepEqual(planInitiativeOwnerChange(existing, null, "佐藤（旧入力）"), {
    mode: "keep",
    ownerMemberId: null,
    ownerName: "  佐藤（旧入力）  ",
  });
});

test("legacy free text cannot be replaced with a different free-text value", () => {
  assert.throws(
    () => planInitiativeOwnerChange({ ownerMemberId: null, ownerName: "佐藤" }, null, "田中"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 400 &&
      error.message === "起案責任者はメンバー一覧から選択してください",
  );
});

test("an existing member can be retained without an active-directory lookup", () => {
  assert.deepEqual(
    planInitiativeOwnerChange({ ownerMemberId: 42, ownerName: "退職者 花子" }, 42, "別名"),
    { mode: "keep", ownerMemberId: 42, ownerName: "退職者 花子" },
  );
});

test("an omitted member id keeps both legacy and member owners on unrelated saves", () => {
  assert.deepEqual(
    planInitiativeOwnerChange({ ownerMemberId: 42, ownerName: "退職者 花子" }, undefined),
    { mode: "keep", ownerMemberId: 42, ownerName: "退職者 花子" },
  );
  assert.deepEqual(
    planInitiativeOwnerChange({ ownerMemberId: null, ownerName: "旧入力" }, undefined, "旧入力"),
    { mode: "keep", ownerMemberId: null, ownerName: "旧入力" },
  );
  assert.throws(
    () => planInitiativeOwnerChange({ ownerMemberId: null, ownerName: "旧入力" }, undefined, "別人"),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
});

test("a deliberate member change, or unserializing an existing member, follows the same rules", () => {
  assert.deepEqual(
    planInitiativeOwnerChange({ ownerMemberId: null, ownerName: "旧入力" }, 7),
    { mode: "member", ownerMemberId: 7 },
  );
  assert.deepEqual(
    planInitiativeOwnerChange({ ownerMemberId: 3, ownerName: "前の担当" }, 7),
    { mode: "member", ownerMemberId: 7 },
  );
  assert.throws(
    () => planInitiativeOwnerChange({ ownerMemberId: 3, ownerName: "前の担当" }, null),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
});

test("new owners are resolved from active users and rejected when unknown or inactive", async () => {
  const active = await resolveActiveInitiativeOwner(
    queryReturning(1, [{ id: "9", name: "田中 太郎" }]),
    1,
    9,
  );
  assert.deepEqual(active, { ownerMemberId: 9, ownerName: "田中 太郎" });

  await assert.rejects(
    resolveActiveInitiativeOwner(queryReturning(0), 1, 999),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 400 &&
      error.message === "指定した起案責任者は存在しないか無効です",
  );
  await assert.rejects(
    resolveActiveInitiativeOwner(queryReturning(1, [{ id: "9", name: "   " }]), 1, 9),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
});

test("owner request parsing rejects missing, malformed and invalid member ids", () => {
  for (const value of [undefined, null, "", 0, -1, 1.5, "abc", true, false, [], [1], {}]) {
    assert.throws(
      () => parseOwnerMemberId(value),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
  }
  assert.equal(parseOwnerMemberId("12"), 12);
  assert.equal(parseNullableOwnerMemberId(undefined), null);
  assert.equal(parseNullableOwnerMemberId("12"), 12);
  assert.throws(
    () => parseNullableOwnerMemberId(true),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
  assert.equal(parseOwnerNameHint("  佐藤  "), "佐藤");
  assert.equal(parseOwnerNameHint(undefined), undefined);
});
