"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import type { AdminWorkspace } from "@/lib/admin-data";

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

  const field = "mt-1 w-full max-w-md rounded border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-blue-500";

  return (
    <section data-admin-panel="workspace">
      <h2 className="text-base font-semibold">組織設定</h2>
      <p className="mt-0.5 text-xs text-muted">
        組織の名前を変更して Atlas をカスタマイズします。サイドバーや招待メールに表示されます。
      </p>

      <div className="mt-4 rounded-lg border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">会社のプロフィール</h3>
        <div className="mt-3">
          <label className="text-xs font-medium text-secondary">組織名</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
            data-admin-org-name-input
            maxLength={120}
          />
          <p className="mt-1 text-[11px] text-subtle">
            組織の名前を変更して Atlas をカスタマイズします。
          </p>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !name.trim() || name.trim() === workspace.name}
            data-admin-org-save
            className="rounded bg-[#4075cf] px-3 py-1.5 text-sm text-white hover:bg-[#3567b8] disabled:opacity-50"
          >
            {saving ? "保存中…" : "変更内容を保存"}
          </button>
          {msg && <span className="text-sm text-secondary">{msg}</span>}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="text-[11px] font-medium text-muted">組織 ID</div>
          <div className="mt-1 font-mono text-sm">{workspace.id}</div>
          <div className="mt-1 text-[11px] text-subtle">ワークスペースの識別子</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="text-[11px] font-medium text-muted">メンバー</div>
          <div className="mt-1 text-xl font-semibold">{workspace.user_count}</div>
          <div className="mt-1 text-[11px] text-subtle">有効なユーザー</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="text-[11px] font-medium text-muted">チーム</div>
          <div className="mt-1 text-xl font-semibold">{workspace.team_count}</div>
          <div className="mt-1 text-[11px] text-subtle">作成済みのチーム</div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">プロジェクト</h3>
        <p className="mt-1 text-sm text-secondary">
          このワークスペースには <strong>{workspace.project_count}</strong> 件のプロジェクトがあります。
        </p>
        <p className="mt-1 text-[11px] text-subtle">
          組織名の変更は監査ログにも記録されます。
        </p>
      </div>
    </section>
  );
}
