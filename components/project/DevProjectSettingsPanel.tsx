"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { normalizeDevPrefix } from "@/lib/dev-project-keys";
import type { DevProjectSettingsView } from "@/lib/services/dev-projects";
import { toast } from "@/lib/ui-feedback";
import {
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  formSectionTitleClass,
  primaryButtonClass,
  SelectControl,
} from "../ui/form-controls";

/**
 * Project settings → 開発 (docs/dev-projects-phase0.md §9). Saves on its own,
 * separately from the dialog's 保存 button.
 */
export default function DevProjectSettingsPanel({
  projectId,
  initial,
  onChanged,
}: {
  projectId: number;
  initial: DevProjectSettingsView;
  onChanged: (next: DevProjectSettingsView) => void;
}) {
  const [view, setView] = useState(initial);
  const [prefix, setPrefix] = useState(initial.dev?.prefix ?? "");
  const [startStatus, setStartStatus] = useState(initial.dev?.start_status ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dev = view.dev;
  const normalized = normalizeDevPrefix(prefix);
  const prefixError = prefix.trim() !== "" && !normalized
    ? "英字で始まる 2〜10 文字の英数字にしてください。"
    : "";
  const dirty = dev !== null && (
    (normalized ?? prefix.trim().toUpperCase()) !== dev.prefix || (startStatus || null) !== dev.start_status
  );

  const apply = (next: DevProjectSettingsView) => {
    setView(next);
    setPrefix(next.dev?.prefix ?? "");
    setStartStatus(next.dev?.start_status ?? "");
    onChanged(next);
  };

  const submit = async () => {
    if (busy || !normalized) return;
    setBusy(true);
    setError("");
    try {
      if (dev === null) {
        const enabled = await api<DevProjectSettingsView & { keyed: number }>(
          `/api/projects/${projectId}/dev`, "POST", { prefix: normalized, start_status: startStatus || null },
        );
        apply(enabled);
        toast(`開発プロジェクトにしました（既存のタスク ${enabled.keyed} 件にキーを付けました）`);
      } else {
        const patch: Record<string, unknown> = {};
        if (normalized !== dev.prefix) patch.prefix = normalized;
        if ((startStatus || null) !== dev.start_status) patch.start_status = startStatus || null;
        apply(await api<DevProjectSettingsView>(`/api/projects/${projectId}/dev`, "PATCH", patch));
        toast("開発設定を保存しました");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const example = `${normalized ?? "ATL"}-123`;
  return (
    <div className="space-y-4" data-project-settings-panel="dev">
      <div>
        <h3 className={formSectionTitleClass}>{dev ? "開発プロジェクト" : "開発プロジェクトにする"}</h3>
        <p className={`mt-1 ${fieldHintClass}`}>
          開発プロジェクトのタスクには {example} のような課題キーが付きます。Claude Code などのコーディングエージェントは、
          キーでタスクを参照し、start_task で着手できます。
          {dev === null && " 有効にすると、このプロジェクトの既存のタスクにもキーを付けます。"}
        </p>
      </div>

      <label className="block">
        <span className={fieldLabelClass}>接頭辞</span>
        <input
          value={prefix}
          onChange={(event) => setPrefix(event.target.value)}
          placeholder="ATL"
          maxLength={10}
          autoCapitalize="characters"
          spellCheck={false}
          className={`mt-1.5 max-w-[12rem] font-mono uppercase ${fieldControlClass}`}
          data-dev-prefix-input
        />
        {prefixError ? (
          <span className="mt-1 block text-[12px] text-danger">{prefixError}</span>
        ) : (
          <span className={`mt-1 block ${fieldHintClass}`}>
            {dev
              ? `接頭辞は変更できます。変更しても、今の接頭辞のキー（${dev.prefix}-123 など）は引き続き使え、ほかのプロジェクトでは使えません。作業ブランチ名（${dev.branch_prefix}-123 など）は変わりません。`
              : "英字で始まる 2〜10 文字の英数字。組織の中で重複できません。"}
          </span>
        )}
        {dev && dev.old_prefixes.length > 0 && (
          <span className={`mt-1 block ${fieldHintClass}`} data-dev-old-prefixes>
            以前の接頭辞（引き続き使えます）: {dev.old_prefixes.join("、")}
          </span>
        )}
      </label>

      <label className="block">
        <span className={fieldLabelClass}>着手時の状態</span>
        <SelectControl
          containerClassName="mt-1.5 max-w-xs"
          value={startStatus}
          onChange={(event) => setStartStatus(event.target.value)}
          data-dev-start-status
        >
          <option value="">未設定</option>
          {view.status_options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </SelectControl>
        <span className={`mt-1 block ${fieldHintClass}`}>
          start_task で着手したとき、状態がこれより前なら、この状態に進めます。
          {!view.status_field_enabled && " このプロジェクトでは状態フィールドが無効なので、状態は変わりません。"}
        </span>
        {dev && dev.start_status === null && (
          <span className="mt-1 block text-[12px] text-warning" data-dev-start-status-unset>
            着手時の状態が未設定です。着手しても担当者だけが設定され、状態は変わりません。
          </span>
        )}
      </label>

      {error && <p className="text-[12px] text-danger" role="alert">{error}</p>}
      <div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !normalized || (dev !== null && !dirty)}
          className={primaryButtonClass}
          data-dev-submit
        >
          {busy ? "保存中…" : dev ? "開発設定を保存" : "開発プロジェクトにする"}
        </button>
      </div>
    </div>
  );
}
