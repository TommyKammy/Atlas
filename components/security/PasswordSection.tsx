"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type { SecuritySettings } from "@/lib/admin-data";
import { SectionHeader } from "./SectionHeader";

export function PasswordSection({
  settings,
  onSettings,
}: {
  settings: SecuritySettings;
  onSettings: (settings: SecuritySettings) => void;
}) {
  const [minLength, setMinLength] = useState(String(settings.password_min_length));
  const [upper, setUpper] = useState(settings.password_require_upper);
  const [lower, setLower] = useState(settings.password_require_lower);
  const [number, setNumber] = useState(settings.password_require_number);
  const [symbol, setSymbol] = useState(settings.password_require_symbol);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const data = await api<{ settings: SecuritySettings }>("/api/admin/security", "PATCH", {
        password_min_length: Number(minLength),
        password_require_upper: upper,
        password_require_lower: lower,
        password_require_number: number,
        password_require_symbol: symbol,
      });
      onSettings(data.settings);
      setMsg("パスワード強度の設定を保存しました");
    } catch (e) {
      setMsg(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-security-section="password">
      <SectionHeader
        title="パスワード強度"
        description="全員のパスワード要件を設定します。変更は新しく作成されるパスワードのみに適用されます。"
      />
      <div className="mt-4 max-w-xl rounded-lg border border-line p-4">
        <label className="text-xs text-secondary">
          最小文字数
          <input
            type="number"
            min={8}
            max={64}
            value={minLength}
            onChange={(e) => setMinLength(e.target.value)}
            className="mt-1 w-24 rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
            data-password-min-length
          />
          <span className="mt-1 block text-[11px] text-subtle">
            メンバーとゲストのパスワードは、{minLength || 8} 文字以上である必要があります。
          </span>
        </label>
        <div className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} />
            大文字を含む
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={lower} onChange={(e) => setLower(e.target.checked)} />
            小文字を含む
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={number} onChange={(e) => setNumber(e.target.checked)} />
            数字を含む
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={symbol} onChange={(e) => setSymbol(e.target.checked)} />
            記号を含む
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            data-password-save
            className="rounded bg-[#4075cf] px-3 py-1.5 text-sm text-white hover:bg-[#3567b8] disabled:opacity-50"
          >
            {saving ? "保存中…" : "変更内容を保存"}
          </button>
          {msg && <span className="text-sm text-secondary">{msg}</span>}
        </div>
      </div>
      <div className="mt-3 max-w-xl rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        パスワードはユーザー作成、管理者による再設定、招待の承諾、プロフィールからの変更時に検証されます。
      </div>
    </div>
  );
}

