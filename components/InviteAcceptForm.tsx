"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理者",
  member: "メンバー",
  guest: "ゲスト",
};

export default function InviteAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<{
    email: string;
    role: string;
    workspace_name: string;
    expires_at: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/invitations/${token}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? `招待を確認できません (${res.status})`);
        setInvite(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  const accept = async () => {
    setError("");
    if (!name.trim()) {
      setError("名前を入力してください");
      return;
    }
    if (password.length < 8) {
      setError("パスワードは8文字以上にしてください");
      return;
    }
    if (password !== confirm) {
      setError("確認用パスワードが一致しません");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/invitations/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `参加に失敗しました (${res.status})`);
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full rounded border px-3 py-2 text-sm outline-none focus:border-blue-500";
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 p-6 shadow-sm">
        {!invite && !error && <p className="text-sm text-neutral-500">招待を確認しています…</p>}
        {error && !invite && (
          <div>
            <h1 className="text-lg font-semibold">招待を開けませんでした</h1>
            <p className="mt-2 text-sm text-red-600">{error}</p>
            <a href="/login" className="mt-4 inline-block text-sm text-blue-700 hover:underline">
              ログインへ
            </a>
          </div>
        )}
        {invite && (
          <>
            <h1 className="text-xl font-semibold">{invite.workspace_name} への招待</h1>
            <p className="mt-1 text-sm text-neutral-500">
              {invite.email} ・ {ROLE_LABEL[invite.role] ?? invite.role}
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              有効期限: {invite.expires_at.slice(0, 10)}
            </p>
            <div className="mt-4 space-y-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="表示名"
                autoComplete="name"
                className={field}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワード（8文字以上）"
                autoComplete="new-password"
                className={field}
              />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="パスワード（確認）"
                autoComplete="new-password"
                className={field}
                onKeyDown={(e) => {
                  if (e.key === "Enter") accept();
                }}
              />
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <button
              type="button"
              onClick={accept}
              disabled={saving}
              className="mt-4 w-full rounded-md bg-[#4075cf] px-4 py-2 text-sm font-medium text-white hover:bg-[#3567b8] disabled:opacity-50"
            >
              {saving ? "参加中…" : "招待を承認して参加"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
