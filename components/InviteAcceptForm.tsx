"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fieldControlClass,
  fieldLabelClass,
  primaryButtonClass,
} from "./ui/form-controls";

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
      if (data?.saml_required) {
        window.location.assign(new URL("/api/auth/saml/start", window.location.origin));
        return;
      }
      router.push(data?.two_factor_setup_required ? "/profile#two-factor" : "/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-[400px] rounded-lg border border-line bg-surface p-6">
        {!invite && !error && <p className="text-[13px] text-muted">招待を確認しています…</p>}
        {error && !invite && (
          <div>
            <h1 className="text-[16px] font-semibold leading-6 text-text">招待を開けませんでした</h1>
            <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>
            <a href="/login" className="mt-4 inline-block text-[13px] text-accent-text hover:underline">
              ログインへ
            </a>
          </div>
        )}
        {invite && (
          <>
            <h1 className="text-[16px] font-semibold leading-6 text-text">{invite.workspace_name} への招待</h1>
            <p className="mt-1 text-[13px] text-muted">
              {invite.email} ・ {ROLE_LABEL[invite.role] ?? invite.role}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-muted">
              有効期限: {invite.expires_at.slice(0, 10)}
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className={fieldLabelClass}>表示名</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="表示名"
                  autoComplete="name"
                  className={`mt-1.5 ${fieldControlClass}`}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>パスワード（8文字以上）</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="パスワード（8文字以上）"
                  autoComplete="new-password"
                  className={`mt-1.5 ${fieldControlClass}`}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>パスワード（確認）</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="パスワード（確認）"
                  autoComplete="new-password"
                  className={`mt-1.5 ${fieldControlClass}`}
                  onKeyDown={(e) => {
                    if (isImeComposing(e)) return;
                    if (e.key === "Enter") accept();
                  }}
                />
              </label>
            </div>
            {error && <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>}
            <button
              type="button"
              onClick={accept}
              disabled={saving}
              className={`mt-4 w-full ${primaryButtonClass}`}
            >
              {saving ? "参加中…" : "招待を承認して参加"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
