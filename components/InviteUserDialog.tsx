"use client";

import { useEffect, useState } from "react";

export default function InviteUserDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ url: string; emailed: boolean; reason: string | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const invite = async () => {
    setBusy(true);
    setMsg("");
    setResult(null);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `招待に失敗しました (${res.status})`);
      setResult({
        url: data.invitation.url,
        emailed: data.emailed === true,
        reason: data.mail_reason ?? null,
      });
      setEmail("");
      setMsg(data.emailed ? "招待メールを送信しました" : "招待を作成しました");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-[#4075cf]";
  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 text-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="invite-dialog-title" className="text-lg font-semibold">
            メンバーを招待
          </h2>
          <button type="button" onClick={onClose} className="text-xl leading-none text-neutral-400 hover:text-neutral-700" aria-label="閉じる">
            ×
          </button>
        </div>
        <p className="mt-1 text-sm text-neutral-500">メールアドレスと権限を指定して招待します。</p>
        <div className="mt-4 space-y-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="メールアドレス"
            type="email"
            autoComplete="off"
            className={field}
            onKeyDown={(e) => {
              if (e.key === "Enter") invite();
            }}
          />
          <select value={role} onChange={(e) => setRole(e.target.value)} className={field}>
            <option value="member">メンバー</option>
            <option value="guest">ゲスト</option>
            <option value="admin">管理者</option>
          </select>
          <button
            type="button"
            onClick={invite}
            disabled={busy || !email.trim()}
            className="w-full rounded-md bg-[#4075cf] px-4 py-2 text-sm font-medium text-white hover:bg-[#3567b8] disabled:opacity-40"
          >
            {busy ? "送信中…" : "招待を送る"}
          </button>
        </div>
        {msg && <p className="mt-2 text-xs text-neutral-600">{msg}</p>}
        {result && (
          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs">
            <div className="font-medium text-blue-900">
              {result.emailed ? "招待メールを送信しました" : "SMTP未設定: 下のリンクを共有してください"}
            </div>
            <div className="mt-1 flex gap-1">
              <input readOnly value={result.url} className="min-w-0 flex-1 rounded border bg-white px-2 py-1 font-mono" />
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(result.url).catch(() => undefined)}
                className="rounded border bg-white px-2 py-1 text-neutral-700 hover:bg-neutral-50"
              >
                コピー
              </button>
            </div>
            {result.reason && <div className="mt-1 text-neutral-500">{result.reason}</div>}
          </div>
        )}
        <div className="mt-4 text-right">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
