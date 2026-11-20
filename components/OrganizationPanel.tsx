"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import type { AdminWorkspace } from "@/lib/admin-data";
import {
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  formSectionTitleClass,
  primaryButtonClass,
} from "./ui/form-controls";

export default function OrganizationPanel({ initial }: { initial: AdminWorkspace }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      setMsg("組織名を入力してください");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const data = await api<{ workspace: AdminWorkspace }>("/api/admin/workspace", "PATCH", {
        name: name.trim(),
      });
      setWorkspace(data.workspace);
      setName(data.workspace.name);
      setMsg("組織名を更新しました");
      router.refresh();
    } catch (e) {
      setMsg(`更新に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-admin-panel="workspace">
      <h2 className="text-[16px] font-semibold leading-6 text-text">組織設定</h2>
      <p className="mt-1 text-[13px] leading-5 text-muted">
        組織の名前を変更して Atlas をカスタマイズします。サイドバーや招待メールに表示されます。
      </p>

      <div className="mt-5 max-w-md">
        <h3 className={formSectionTitleClass}>会社のプロフィール</h3>
        <label className="mt-3 block">
          <span className={fieldLabelClass}>組織名</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`mt-1.5 ${fieldControlClass}`}
            data-admin-org-name-input
            maxLength={120}
          />
        </label>
        <p className={`mt-1.5 ${fieldHintClass}`}>
          組織の名前を変更して Atlas をカスタマイズします。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !name.trim() || name.trim() === workspace.name}
            data-admin-org-save
            className={primaryButtonClass}
          >
            {saving ? "保存中…" : "変更内容を保存"}
          </button>
          {msg && <span className="text-[12px] text-secondary">{msg}</span>}
        </div>
      </div>

      <div className="mt-6 grid max-w-2xl gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-surface-subtle p-4">
          <div className="text-[12px] font-medium text-muted">組織 ID</div>
          <div className="mt-1 font-mono text-[13px] tabular-nums text-text">{workspace.id}</div>
          <div className="mt-1 text-[12px] text-muted">ワークスペースの識別子</div>
        </div>
        <div className="rounded-lg bg-surface-subtle p-4">
          <div className="text-[12px] font-medium text-muted">メンバー</div>
          <div className="mt-1 text-[16px] font-semibold tabular-nums text-text">{workspace.user_count}</div>
          <div className="mt-1 text-[12px] text-muted">有効なユーザー</div>
        </div>
        <div className="rounded-lg bg-surface-subtle p-4">
          <div className="text-[12px] font-medium text-muted">チーム</div>
          <div className="mt-1 text-[16px] font-semibold tabular-nums text-text">{workspace.team_count}</div>
          <div className="mt-1 text-[12px] text-muted">作成済みのチーム</div>
        </div>
      </div>

      <div className="mt-6 max-w-2xl rounded-lg bg-surface-subtle p-4">
        <h3 className={formSectionTitleClass}>プロジェクト</h3>
        <p className="mt-1 text-[13px] text-secondary">
          このワークスペースには <strong className="tabular-nums">{workspace.project_count}</strong> 件のプロジェクトがあります。
        </p>
        <p className="mt-1 text-[12px] text-muted">組織名の変更は監査ログにも記録されます。</p>
      </div>
    </section>
  );
}
