import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { resolveWebhookDestination } from "./automation/webhook-outbound";
import { ApiError, badRequest } from "./api/errors";

export type LlmProvider = "openai" | "compatible";
export type LlmEndpoint = { provider: LlmProvider; base_url: string; model: string; max_output_tokens: number; timeout_seconds: number };
export function localEndpoint(raw: string) {
  return (process.env.LLM_ALLOWED_LOCAL_ORIGINS ?? "").split(",").map(v => v.trim()).filter(Boolean).includes(new URL(raw).origin);
}
export function normalizeLlmUrl(provider: LlmProvider, raw: string) {
  if (provider === "openai") return "https://api.openai.com/v1";
  let url: URL;
  try { url = new URL(raw); } catch { throw badRequest("接続先URLが無効です"); }
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) throw badRequest("認証情報・クエリを含まないHTTP(S)のURLを指定してください");
  if (url.protocol !== "https:" && !localEndpoint(url.href)) throw badRequest("HTTPの接続先はサーバー側の許可リストへの登録が必要です");
  return url.href.replace(/\/+$/, "");
}

/** DNS is vetted and pinned for the request. No redirects, proxies, or retries. */
export async function llmJson(base: string, path: string, key: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  try {
    const resolve = (hostname: string) => new Promise<{ address: string; family: number }[]>((done, fail) => {
      signal.throwIfAborted();
      const abort = () => fail(new Error("lookup aborted"));
      signal.addEventListener("abort", abort, { once: true });
      lookup(hostname, { all: true }).then(done, fail).finally(() => signal.removeEventListener("abort", abort));
    });
    const url = new URL(`${base}${path}`);
    let address: { address: string; family: number }, servername: string | undefined;
    if (localEndpoint(base)) {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const family = isIP(host);
      const addresses = family ? [{ address: host, family }] : await resolve(host);
      address = addresses[0]; servername = family ? undefined : host;
    } else {
      if (url.protocol !== "https:") throw new Error("HTTPS required");
      ({ address, servername } = await resolveWebhookDestination(url.href, resolve));
    }
    signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const outgoing = (url.protocol === "https:" ? httpsRequest : httpRequest)({
        protocol: url.protocol, hostname: address.address, family: address.family, port: url.port,
        servername, path: url.pathname, method: payload === undefined ? "GET" : "POST", agent: false, signal,
        headers: { Host: url.host, Accept: "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}) },
      }, response => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          response.destroy(); reject(new ApiError(502, `LLM接続先がエラーを返しました (${response.statusCode ?? 0})。接続設定を確認してください`)); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_000_000) { response.destroy(); reject(new ApiError(502, "LLMの応答が上限を超えました")); }
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("invalid JSON")); } });
      });
      outgoing.on("error", reject); outgoing.end(payload);
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal.aborted) throw new ApiError(408, "生成を中止したか、待機時間を超えました");
    throw new ApiError(502, "LLMに接続できません。URL、ローカル接続の許可設定、モデルの稼働状態を確認してください");
  }
}
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const tokens = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n < 2147483647 ? n : null;
export function parseLlmResponse(provider: LlmProvider, value: unknown) {
  const data = obj(value); let text: unknown;
  if (provider === "openai") {
    if (data.status !== "completed") throw new ApiError(502, "生成が完了していません。出力上限やモデル設定を確認してください");
    const output = Array.isArray(data.output) ? data.output.map(obj) : [];
    const content = output.filter(v => v.type === "message").flatMap(v => Array.isArray(v.content) ? v.content.map(obj) : []);
    if (content.some(v => v.type !== "output_text")) throw new ApiError(502, "このノートの生成結果を取得できませんでした");
    text = content.map(v => v.text).filter(v => typeof v === "string").join("\n");
  } else {
    const choice = obj(Array.isArray(data.choices) ? data.choices[0] : null), message = obj(choice.message);
    if (choice.finish_reason !== "stop" || message.tool_calls || message.refusal) throw new ApiError(502, "生成が完了していません。出力上限やモデル設定を確認してください");
    text = message.content;
  }
  if (typeof text !== "string" || !text.trim() || text.length > 50000) throw new ApiError(502, "生成結果が空、または上限を超えています");
  const usage = obj(data.usage);
  return { text: text.trim(), input_tokens: tokens(usage.input_tokens ?? usage.prompt_tokens), output_tokens: tokens(usage.output_tokens ?? usage.completion_tokens) };
}
export function llmPayload(config: LlmEndpoint, instruction: string, input: string) {
  return config.provider === "openai"
    ? { model: config.model, instructions: instruction, input, max_output_tokens: config.max_output_tokens, store: false }
    : { model: config.model, messages: [{ role: "system", content: instruction }, { role: "user", content: input }], max_tokens: config.max_output_tokens, stream: false };
}
export async function completeLlm(config: LlmEndpoint, key: string, instruction: string, input: string, signal: AbortSignal) {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(config.timeout_seconds * 1000)]);
  const result = await llmJson(config.base_url, config.provider === "openai" ? "/responses" : "/chat/completions", key, combined, llmPayload(config, instruction, input));
  return parseLlmResponse(config.provider, result);
}
