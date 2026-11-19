"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type { SecuritySettings } from "@/lib/admin-data";
import {
  checkboxClass,
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  formSectionTitleClass,
  primaryButtonClass,
} from "../ui/form-controls";
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
      <div className="mt-4 max-w-xl">
        <div className={formSectionTitleClass}>要件</div>
        <label className="mt-3 block">
          <span className={fieldLabelClass}>最小文字数</span>
          <input
            type="number"
            min={8}
            max={64}
            value={minLength}
            onChange={(e) => setMinLength(e.target.value)}
            className={`mt-1.5 w-24 tabular-nums ${fieldControlClass}`}
            data-password-min-length
          />
          <span className={`mt-1.5 block ${fieldHintClass}`}>
            メンバーとゲストのパスワードは、{minLength || 8} 文字以上である必要があります。
          </span>
        </label>
        <div className="mt-3 grid gap-1.5 text-[13px] text-secondary sm:grid-cols-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} className={checkboxClass} />
            大文字を含む
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={lower} onChange={(e) => setLower(e.target.checked)} className={checkboxClass} />
            小文字を含む
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={number} onChange={(e) => setNumber(e.target.checked)} className={checkboxClass} />
            数字を含む
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={symbol} onChange={(e) => setSymbol(e.target.checked)} className={checkboxClass} />
            記号を含む
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            data-password-save
            className={primaryButtonClass}
          >
            {saving ? "保存中…" : "変更内容を保存"}
          </button>
          {msg && <span className="text-[12px] text-secondary">{msg}</span>}
        </div>
      </div>
      <div className="mt-4 max-w-xl rounded-md bg-surface-subtle px-3 py-2 text-[12px] leading-5 text-secondary">
        パスワードはユーザー作成、管理者による再設定、招待の承諾、プロフィールからの変更時に検証されます。
      </div>
    </div>
  );
}
