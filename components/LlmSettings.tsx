"use client";
import { useEffect, useState } from "react";
type Config = { id?: string; revision?: number; name: string; provider: "openai" | "compatible"; base_url: string; model: string; enabled: boolean; external_allowed: boolean; project_ids: number[]; max_input_chars: number; max_output_tokens: number; timeout_seconds: number; daily_limit: number; key_configured?: boolean };
type Settings = { connections: Config[]; projects: { id: number; name: string }[]; key_ready: boolean; local_origins: string[] };
const empty: Config = { name: "", provider: "compatible", base_url: "", model: "", enabled: false, external_allowed: false, project_ids: [], max_input_chars: 20000, max_output_tokens: 2048, timeout_seconds: 120, daily_limit: 50 };
const button = "rounded border border-line-strong px-3 py-2 text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50";
const field = "mt-1 block w-full rounded border border-line-strong px-3 py-2 text-sm";
async function api(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "操作できませんでした"); return value;
}
export default function LlmSettings() {
  const [data, setData] = useState<Settings | null>(null), [form, setForm] = useState<Config>(empty);
  const [key, setKey] = useState(""), [clear, setClear] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [models, setModels] = useState<string[]>([]);
  useEffect(() => { api("/api/admin/llm").then(setData).catch(e => setError(e.message)); }, []);
  const update = (patch: Partial<Config>) => setForm(v => ({ ...v, ...patch }));
  const pick = (value: Config) => { setForm(value); setKey(""); setClear(false); setModels([]); setNotice(""); setError(""); };
  const save = async (test = false) => {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try {
      const saved = await api("/api/admin/llm", { ...form, api_key: key, clear_key: clear });
      setForm(saved); setKey(""); setClear(false); setData(await api("/api/admin/llm"));
      setNotice("設定を保存しました");
      if (test) {
        const result = await api(`/api/admin/llm/${saved.id}/test`, {});
        setModels(result.models); setNotice(`接続・生成テスト成功：${result.response}`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "操作できませんでした"); }
    finally { setBusy(false); }
  };
  return <div className="space-y-5" data-llm-settings>
    <div><h2 className="text-lg font-semibold">AI接続</h2><p className="mt-1 text-sm text-secondary">プロジェクトで使用する接続・モデルを管理者が指定します。利用者はモデルを変更できません。</p></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="whitespace-pre-wrap text-sm text-neutral-700">{notice}</p>}
    {data && <>
      {!data.key_ready && <p role="alert" className="text-sm text-warning">サーバーに LLM_ENCRYPTION_KEY が必要です。設定手順は docs/llm.md を確認してください。</p>}
      <div className="flex flex-wrap gap-2">{data.connections.map(c => <button key={c.id} disabled={busy} className={button} aria-pressed={form.id === c.id} onClick={() => pick(c)}>{c.name} · {c.enabled ? "有効" : "無効"}</button>)}<button disabled={busy} className={button} onClick={() => pick({ ...empty })}>接続を追加</button></div>
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        <legend className="sr-only">接続設定</legend>
        <button className={button} onClick={() => pick({ ...empty, name: "Local Qwen / MTPLX", base_url: data.local_origins.some(v => v.includes("host.docker.internal:8002")) ? "http://host.docker.internal:8002/v1" : "http://127.0.0.1:8002/v1", model: "mtplx-flash-next-optimized-speed" })}>MTPLXの設定例を入力</button>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">接続名<input className={field} value={form.name} maxLength={100} onChange={e => update({ name: e.target.value })} /></label>
          <label className="text-sm">接続方式<select className={field} value={form.provider} onChange={e => { update({ provider: e.target.value as Config["provider"], base_url: e.target.value === "openai" ? "https://api.openai.com/v1" : "", enabled: false }); setKey(""); }}><option value="compatible">OpenAI互換（MTPLXなど）</option><option value="openai">OpenAI公式</option></select></label>
        </div>
        <label className="block text-sm">Base URL<input className={field} value={form.base_url} disabled={form.provider === "openai"} onChange={e => update({ base_url: e.target.value })} placeholder="http://host.docker.internal:8002/v1" /></label>
        <p className="text-xs leading-relaxed text-secondary">Docker内からホストのMTPLXへは host.docker.internal:8002 を使います。ローカル接続はサーバーの許可リストへの登録が必要です。登録済み：{data.local_origins.join(", ") || "なし"}</p>
        <label className="block text-sm">モデルID<input className={field} list="llm-models" value={form.model} maxLength={200} onChange={e => update({ model: e.target.value })} /><datalist id="llm-models">{models.map(m => <option key={m} value={m} />)}</datalist></label>
        <label className="block text-sm">APIキー {form.key_configured ? "（設定済み・空欄で維持）" : "（未設定・MTPLXでは省略可）"}<input type="password" autoComplete="new-password" className={field} value={key} onChange={e => setKey(e.target.value)} /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={clear} onChange={e => setClear(e.target.checked)} />保存済みのAPIキーを削除する</label>
        <p className="text-xs text-secondary">接続方式やURLを変更すると、保存済みのAPIキーは削除されます。</p>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{([
          ["max_input_chars", "入力上限（文字）", 100, 100000], ["max_output_tokens", "出力上限（トークン）", 128, 8192], ["timeout_seconds", "待機時間（秒）", 5, 180], ["daily_limit", "利用者ごとの24時間上限", 1, 1000],
        ] as const).map(([k, label, min, max]) => <label key={k} className="text-sm">{label}<input type="number" className={field} min={min} max={max} value={form[k]} onChange={e => update({ [k]: Number(e.target.value) })} /></label>)}</div>
        <fieldset className="rounded border border-neutral-200 p-3"><legend className="px-1 text-sm">この接続・モデルを使用するプロジェクト</legend><div className="max-h-48 space-y-2 overflow-auto">{data.projects.map(p => <label key={p.id} className="flex gap-2 text-sm"><input type="checkbox" checked={form.project_ids.includes(p.id)} onChange={e => update({ project_ids: e.target.checked ? [...form.project_ids, p.id] : form.project_ids.filter(id => id !== p.id) })} />{p.name}</label>)}</div></fieldset>
        <p className="text-xs leading-relaxed text-secondary">有効な接続を保存すると、選択したプロジェクトはこの接続・モデルを使用します。別の接続が指定されている場合は切り替わります。</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.external_allowed} onChange={e => update({ external_allowed: e.target.checked })} />外部サービスへのノート送信を許可する（ローカル接続には不要）</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => update({ enabled: e.target.checked })} />この接続を有効にする</label>
        <p className="text-xs leading-relaxed text-secondary">接続テストは固定の挨拶文を送信し、モデル一覧と応答を確認します。外部サービスでは料金が発生する場合があります。OpenAI公式には保存無効で送信しますが、サービス側の保持ポリシーは別途適用されます。</p>
        <div className="flex gap-2"><button disabled={!data.key_ready} className={button} onClick={() => void save()}>設定を保存</button><button disabled={!data.key_ready} className={button} onClick={() => void save(true)}>保存して接続テスト</button></div>
      </fieldset>
    </>}
  </div>;
}
