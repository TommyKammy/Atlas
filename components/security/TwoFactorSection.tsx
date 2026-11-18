"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { confirmAction } from "@/lib/ui-feedback";
import type { SecuritySettings, TotpUserRow } from "@/lib/admin-data";
import UserAvatar from "../UserAvatar";
import { SectionHeader } from "./SectionHeader";

export function TwoFactorSection({
  settings,
  totpUsers,
  onSettings,
  currentUserId,
}: {
  settings: SecuritySettings;
  totpUsers: TotpUserRow[];
  onSettings: (settings: SecuritySettings, users?: TotpUserRow[]) => void;
  currentUserId: number;
}) {
  const [policy, setPolicy] = useState(settings.two_factor_policy);
  const [users, setUsers] = useState(totpUsers);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const data = await api<{ settings: SecuritySettings; totpUsers: TotpUserRow[] }>(
        "/api/admin/security",
        "PATCH",
        { two_factor_policy: policy },
      );
      onSettings(data.settings, data.totpUsers);
      setMsg("二要素認証の設定を保存しました");
    } catch (e) {
      setMsg(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const resetUser = async (user: TotpUserRow) => {
    if (!(await confirmAction(`${user.name} の二要素認証をリセットしますか？`))) return;
    try {
      await api(`/api/admin/users/${user.id}/2fa`, "DELETE");
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, totp_enabled: false, totp_enrolled_at: null } : u)));
    } catch (e) {
      setMsg(`リセットに失敗しました: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div data-security-section="two-factor">
      <SectionHeader
        title="二要素認証"
        description="メンバーとゲストに 2 つ目の認証方法を使用してサインインすることを義務づけます。"
      />
      <div className="mt-4 max-w-2xl rounded-lg border border-line p-4">
        <div className="text-xs font-medium text-secondary">二要素認証のポリシー</div>
        <div className="mt-2 space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="two-factor-policy"
              checked={policy === "optional"}
              onChange={() => setPolicy("optional")}
              data-two-factor-policy-optional
            />
            <span>
              任意
              <span className="block text-[11px] text-subtle">
                ユーザーが自分のプロフィールから二要素認証を有効化できます。
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="two-factor-policy"
              checked={policy === "required"}
              onChange={() => setPolicy("required")}
              data-two-factor-policy-required
            />
            <span>
              すべてのメンバーとゲストに対して必須
              <span className="block text-[11px] text-subtle">
                次回サインイン時に、プロフィールから二要素認証の設定を促します。
              </span>
            </span>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            data-two-factor-save
            className="rounded bg-accent px-3 py-1.5 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "保存中…" : "変更内容を保存"}
          </button>
          {msg && <span className="text-sm text-secondary">{msg}</span>}
        </div>
      </div>

      <div className="mt-4 max-w-2xl rounded-lg border border-line p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">メンバーの二要素認証</h4>
          <a href="/profile#two-factor" className="text-xs text-accent-text hover:underline">
            自分の設定を開く →
          </a>
        </div>
        <div className="mt-2 divide-y">
          {users.map((user) => (
            <div key={user.id} className="flex items-center gap-2 py-2 text-sm" data-totp-user={user.id}>
              <UserAvatar name={user.name} url={null} className="h-6 w-6" textClassName="text-[9px]" />
              <span className="min-w-0 flex-1 truncate">
                {user.name}
                {user.id === currentUserId && <span className="ml-1 text-[10px] text-subtle">(自分)</span>}
              </span>
              <span className="w-24 text-[11px] text-muted">{user.role_name ?? "–"}</span>
              <span
                className={`w-20 rounded px-1.5 py-0.5 text-center text-[11px] ${
                  user.totp_enabled ? "bg-emerald-100 text-emerald-700" : "bg-surface-muted text-muted"
                }`}
              >
                {user.totp_enabled ? "有効" : "未設定"}
              </span>
              <button
                onClick={() => resetUser(user)}
                disabled={!user.totp_enabled || !user.can_manage}
                className="rounded border px-1.5 py-0.5 text-xs hover:bg-hover disabled:opacity-40"
              >
                リセット
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

