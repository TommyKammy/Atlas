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
  // Test-only deterministic delay: "delay-65" waits 65s. Existing fixture
  // models keep their original behavior. Cap the delay at 5 minutes.
  const delay = /^delay-(\d{1,3})$/.exec(body.model);
  if (body.model === "slow" || body.model === "timeout") await new Promise(resolve => setTimeout(resolve, body.model === "timeout" ? 6500 : 2500));
  else if (delay) await new Promise(resolve => setTimeout(resolve, Math.min(Number(delay[1]), 300) * 1000));
  let content = body.messages?.[0]?.content.includes("意味を保って")
    ? "文章改善案\n明日はチームで計画を確認します。\n\n改善ポイント\n主語と目的を明確にしました。"
    : "要約\n- チームで計画を確認する。\n- 担当者と期限を決める。\n![実行しない画像](https://example.invalid/track)\n<script>window.aiInjected=true</script>";
  if (body.messages?.[0]?.content.includes("プロジェクトパートナー")) {
    const input = JSON.parse(body.messages[1].content), note = input.documents.find(d => d.source_id.startsWith("N"));
    const action = input.skill === "action_extract";
    const result = { summary: "確認用の提案です。", sections: [{ heading: "確認できたこと", items: [{ text: "参照情報を整理しました。", source_ids: [action ? note.source_id : "F"] }] }],
      actions: action ? [{ title: "計画を確認する", assignee: null, due: null, evidence: note.text.split("\n").filter(Boolean).at(-1), source_id: note.source_id }] : [], questions: ["優先順位を確認してください。"] };
    if (body.model === "partner-two" && action) {
      result.actions[0].evidence = note.text.split("\n").filter(Boolean)[1];
      result.actions.push({ title: "資料をまとめる", assignee: null, due: null, evidence: note.text.split("\n").filter(Boolean).at(-1), source_id: note.source_id });
    }
    if (body.model === "partner-prefill" && action) {
      const section = input.placement_sections?.find(s => s.name === "広報");
      result.actions = [{ title: "公開告知の文章をまとめる", assignee: "佐藤さん", due: "月曜日", evidence: note.text.split("\n").filter(Boolean).at(-1), source_id: note.source_id,
        section_id: section?.id ?? null, section_reason: "公開告知の文章を準備する仕事のため" }];
    }
    if (body.model === "partner-echo") result.summary = JSON.stringify(input);
    if (body.model === "unknown-source") result.sections[0].items[0].source_ids = ["N999999999"];
    if (body.model === "html") result.summary = '<img src=x onerror="window.partnerInjected=true"><script>window.partnerInjected=true</script>';
    content = body.model === "bad-json" ? "not JSON" : JSON.stringify(result);
  }
  res.end(JSON.stringify({ choices: [{ finish_reason: body.model === "truncated" ? "length" : "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 100, completion_tokens: 80 } }));
}).listen(8080, "0.0.0.0");
