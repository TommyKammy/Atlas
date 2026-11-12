import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { llmJson, llmPayload, normalizeLlmUrl, parseLlmResponse } from "./llm-provider";
import { encryptLlmKey, decryptLlmKey, signLlmResult, verifyLlmResult } from "./llm-security";
import { llmNoteText, literalResultDoc } from "./llm-note-text";

test("OpenAI uses Responses API with storage disabled and parses message outputs", () => {
  const config = { provider: "openai" as const, base_url: "https://api.openai.com/v1", model: "configured-model", max_output_tokens: 2048, timeout_seconds: 120 };
  assert.deepEqual(llmPayload(config, "instruction", "note"), { model: "configured-model", instructions: "instruction", input: "note", max_output_tokens: 2048, store: false });
  assert.equal(normalizeLlmUrl("openai", "https://evil.invalid/v1"), "https://api.openai.com/v1");
  assert.deepEqual(parseLlmResponse("openai", { status: "completed", output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "要約" }] }], usage: { input_tokens: 10, output_tokens: 3 } }), { text: "要約", input_tokens: 10, output_tokens: 3 });
  for (const response of [{ status: "incomplete" }, { status: "failed" }, { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }]) assert.throws(() => parseLlmResponse("openai", response));
});
test("compatible API rejects partial, empty, tool and reasoning-only responses", () => {
  for (const response of [{ choices: [] }, { choices: [{ finish_reason: "length", message: { content: "partial" } }] }, { choices: [{ finish_reason: "stop", message: { reasoning_content: "private" } }] }, { choices: [{ finish_reason: "stop", message: { content: "text", tool_calls: [] } }] }]) assert.throws(() => parseLlmResponse("compatible", response));
  assert.equal(parseLlmResponse("compatible", { choices: [{ finish_reason: "stop", message: { content: "answer", reasoning_content: "hidden" } }] }).text, "answer");
});
test("selected document conversion excludes link targets, images and preserves useful structure", () => {
  const text = llmNoteText({ title: "計画", body: "ignored legacy", body_doc: { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "見出し" }] },
    { type: "paragraph", content: [{ type: "text", text: "参照", marks: [{ type: "link", attrs: { href: "https://secret.invalid/token" } }] }] },
    { type: "image", attrs: { src: "https://image.invalid/token" } },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] }] }] },
  ] } });
  assert.match(text, /## 見出し/); assert.match(text, /A \| B/); assert.doesNotMatch(text, /https|secret|ignored legacy/);
  assert.equal(llmNoteText({ title: "T", body_doc: null, body: "[リンク](https://secret.invalid/a) https://secret.invalid/b" }), "T\n\nリンク [URL省略]");
  assert.deepEqual(literalResultDoc("![image](https://x)"), { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "![image](https://x)" }] }] });
});
test("encrypted credentials and signed results resist tampering and cross-profile reuse", () => {
  const before = process.env.LLM_ENCRYPTION_KEY;
  process.env.LLM_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const cipher = encryptLlmKey("test-secret", "profile-a"); assert.ok(!cipher.includes("test-secret"));
    assert.equal(decryptLlmKey(cipher, "profile-a"), "test-secret"); assert.throws(() => decryptLlmKey(cipher, "profile-b"));
    const data = { uid: 1, text: "note", expires: Date.now()+10000 }, token = signLlmResult(data);
    assert.deepEqual(verifyLlmResult(token), data); assert.throws(() => verifyLlmResult(`${token}x`));
    assert.throws(() => verifyLlmResult(signLlmResult({ expires: 0 })));
  } finally { if (before === undefined) delete process.env.LLM_ENCRYPTION_KEY; else process.env.LLM_ENCRYPTION_KEY = before; }
});
test("outbound transport denies unapproved private hosts, redirects, oversized bodies and aborts", async () => {
  const before = process.env.LLM_ALLOWED_LOCAL_ORIGINS;
  const server = createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { Location: "http://169.254.169.254/" }); res.end(); }
    else if (req.url === "/huge") res.end('"'+"x".repeat(1000001)+'"');
    else if (req.url === "/slow") { /* cancelled by client */ }
    else res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number }, origin = `http://127.0.0.1:${address.port}`;
  try {
    process.env.LLM_ALLOWED_LOCAL_ORIGINS = "";
    assert.throws(() => normalizeLlmUrl("compatible", origin));
    await assert.rejects(llmJson("https://127.0.0.1", "/", "", AbortSignal.timeout(1000)));
    process.env.LLM_ALLOWED_LOCAL_ORIGINS = origin;
    assert.equal(normalizeLlmUrl("compatible", `${origin}/v1/`), `${origin}/v1`);
    assert.deepEqual(await llmJson(origin, "/", "", AbortSignal.timeout(1000)), { ok: true });
    await assert.rejects(llmJson(origin, "/redirect", "", AbortSignal.timeout(1000)));
    await assert.rejects(llmJson(origin, "/huge", "", AbortSignal.timeout(1000)));
    await assert.rejects(llmJson(origin, "/slow", "", AbortSignal.timeout(30)));
    assert.throws(() => normalizeLlmUrl("compatible", `${origin}/v1?key=secret`));
  } finally { if (before === undefined) delete process.env.LLM_ALLOWED_LOCAL_ORIGINS; else process.env.LLM_ALLOWED_LOCAL_ORIGINS = before; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
