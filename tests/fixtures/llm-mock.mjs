import { createServer } from "node:http";
// Disposable CI network only. There is no published port and no real credential.
createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "fixture" }, { id: "slow" }, { id: "truncated" }] }));
  if (req.url !== "/v1/chat/completions") { res.writeHead(404); return res.end("{}"); }
  let raw = "";
  for await (const part of req) { raw += part; if (raw.length > 500000) { res.writeHead(413); return res.end("{}"); } }
  const body = JSON.parse(raw);
  if (body.model === "error") { res.writeHead(503); return res.end(JSON.stringify({ error: "never log this provider body or credentials" })); }
  if (body.model === "slow" || body.model === "timeout") await new Promise(resolve => setTimeout(resolve, body.model === "timeout" ? 6500 : 2500));
  const content = body.messages?.[0]?.content.includes("意味を保って")
    ? "文章改善案\n明日はチームで計画を確認します。\n\n改善ポイント\n主語と目的を明確にしました。"
    : "要約\n- チームで計画を確認する。\n- 担当者と期限を決める。\n![実行しない画像](https://example.invalid/track)\n<script>window.aiInjected=true</script>";
  res.end(JSON.stringify({ choices: [{ finish_reason: body.model === "truncated" ? "length" : "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 100, completion_tokens: 80 } }));
}).listen(8080, "0.0.0.0");
