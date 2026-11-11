"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { api } from "@/lib/api-client";
import { useEffect, useState } from "react";
import { useApiRefresh } from "@/lib/use-api-refresh";


export default function ShareLinks({ projectId }: { projectId: number }) {
  const refresh = useApiRefresh();
  const [tokens, setTokens] = useState<
    { id: number; label: string; created_at: string; expires_at: string | null }[]
  >([]);
  const [canManage, setCanManage] = useState(false);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");

  const load = async () => {
    const res = await fetch(`/api/projects/${projectId}/share`);
    setCanManage(res.ok);
    setTokens(res.ok ? await res.json() : []);
  };
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const create = async () => {
    const { token } = await api<{ token: string }>(`/api/projects/${projectId}/share`, "POST", {
      label,
      expires_in_days: expiry === "" ? null : Number(expiry),
    });
    setLabel("");
    await load();
    await navigator.clipboard?.writeText(`${location.origin}/share/${token}`).catch(() => undefined);
    refresh();
  };

  const revoke = async (id: number) => {
    if (!await confirmAction("共有リンクを無効化しますか？")) return;
    await api(`/api/projects/${projectId}/share?token_id=${id}`, "DELETE");
    load();
  };

  return (
    <div className="mt-6">
      <h2 className="font-semibold">共有リンク（読み取り専用）</h2>
      {!canManage && <p className="mt-1 text-sm text-neutral-500">共有リンクの管理には共有権限が必要です。</p>}
      {canManage && tokens.length === 0 && (
        <p className="mt-1 text-sm text-neutral-500">発行済みリンクはありません。</p>
      )}
      {tokens.map((t) => (
        <div key={t.id} className="flex items-center gap-2 border-b py-1.5 font-mono text-xs">
          <span className="min-w-0 flex-1 truncate text-neutral-600">
            {t.label || "(無題)"} ・ {t.created_at}
            {t.expires_at ? ` ・ 期限:${t.expires_at.slice(0, 10)}` : " ・ 無期限"}
          </span>
          <button onClick={() => revoke(t.id)} className="shrink-0 text-neutral-400 hover:text-red-600" title="無効化">
            ×
          </button>
        </div>
      ))}
      {canManage && <div className="mt-2 flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="ラベル（任意）"
          className="rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
        />
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="rounded border px-2 py-1 text-sm">
          <option value="">無期限</option>
          <option value="7">7日間</option>
          <option value="30">30日間</option>
        </select>
        <button onClick={create} className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700">
          発行＋コピー
        </button>
      </div>}
    </div>
  );
}
