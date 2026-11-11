import assert from "node:assert/strict";
import { test } from "node:test";
import { isImeComposing } from "./ime-keyboard";

test("IME guards native and React keyboard events, including conversion-confirmation keyCode 229", () => {
  assert.equal(isImeComposing({ isComposing: true }), true);
  assert.equal(isImeComposing({ keyCode: 229 }), true);
  assert.equal(isImeComposing({ isComposing: false, keyCode: 229 }), true);
  assert.equal(isImeComposing({ nativeEvent: { isComposing: true, keyCode: 13 } }), true);
  assert.equal(isImeComposing({ nativeEvent: { isComposing: false, keyCode: 229 } }), true);
  assert.equal(isImeComposing({ isComposing: false, nativeEvent: { isComposing: false, keyCode: 13 } }), false);
  assert.equal(isImeComposing({ keyCode: 13 }), false);
  assert.equal(isImeComposing({}), false);
});


test("composing Escape stays with the IME instead of blur, dialog close or menu navigation", () => {
  const nativeCancel = { key: "Escape", keyCode: 27, isComposing: true };
  const afterComposition = { key: "Escape", keyCode: 229, isComposing: false };
  const ordinaryCancel = { key: "Escape", keyCode: 27, isComposing: false };
  assert.equal(isImeComposing(nativeCancel), true);
  assert.equal(isImeComposing({ nativeEvent: nativeCancel }), true);
  assert.equal(isImeComposing(afterComposition), true);
  assert.equal(isImeComposing(ordinaryCancel), false);
});
