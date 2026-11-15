"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { toast } from "@/lib/ui-feedback";
import Dialog from "../ui/Dialog";
import ProjectMembersManager from "../ProjectMembersManager";
import { PROJECT_DIALOG_PRIMARY, PROJECT_DIALOG_SECONDARY } from "./RenameProjectDialog";
import { normalizeProjectSettings, type ProjectSettings, type ProjectSharingLevel } from "@/lib/project-settings";
import type { CustomField } from "@/lib/custom-fields";

type SettingsPayload = { project: { settings: ProjectSettings } };

const EDIT_LEVEL_OPTIONS: { value: ProjectSharingLevel; label: string; description: string }[] = [
  { value: "editors", label: "編集可能ユーザー以上", description: "プロジェクトの編集者がワークフロー、ステータス、外観を変更できます。" },
  { value: "admins", label: "プロジェクト管理者のみ", description: "管理者だけがワークフロー、ステータス、外観を変更できます。" },
];

const SHARE_LEVEL_OPTIONS: { value: ProjectSharingLevel; label: string; description: string }[] = [
  { value: "editors", label: "編集可能ユーザー以上", description: "プロジェクトの編集者がメンバーと共有リンクを管理できます。" },
  { value: "admins", label: "プロジェクト管理者のみ", description: "管理者だけがメンバーと共有リンクを管理できます。" },
];

function accessLabel(field: CustomField): string {
  if (field.access_level === "admins") return "管理者のみ";
  if (field.access_level === "custom") return `特定のユーザー（${field.editor_ids?.length ?? 0}人）`;
  return "全員";
}

export default function ProjectPermissionsDialog({
  projectId,
  projectName,
  customFields,
  onClose,
  onOpenFields,
}: {
  projectId: number;
  projectName: string;
  customFields: CustomField[];
  onClose: () => void;
  onOpenFields: () => void;
}) {
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<SettingsPayload>(`/api/projects/${projectId}/settings`);
        if (!cancelled) setSettings(normalizeProjectSettings(data.project.settings));
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const save = async () => {
    if (!settings || saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/projects/${projectId}`, "PATCH", { settings });
      toast("プロジェクト権限を保存しました");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="プロジェクト権限"
      backdropClassName="backdrop:bg-black/25"
      panelClassName="flex max-h-[90vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-xl bg-white text-sm shadow-2xl"
    >
      <div data-project-permissions-dialog className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-start justify-between border-b border-neutral-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">プロジェクト権限を管理</h2>
            <p className="mt-0.5 text-xs text-neutral-500">{projectName} ・ メンバーとフィールドの編集権限</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-xl leading-none text-neutral-400 hover:text-neutral-700"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <section className="rounded-lg border border-neutral-200 p-4">
            <h3 className="font-semibold">ワークフローと外観を編集できるユーザー</h3>
            <div className="mt-2 space-y-2">
              {EDIT_LEVEL_OPTIONS.map((option) => (
                <label
                  key={`edit-${option.value}`}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 ${
                    settings?.who_can_edit === option.value ? "border-[#4075cf] bg-[#f4f8ff]" : "border-neutral-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="who-can-edit"
                    checked={settings?.who_can_edit === option.value}
                    disabled={!settings}
                    onChange={() =>
                      setSettings((current) => (current ? { ...current, who_can_edit: option.value } : current))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs text-neutral-500">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-lg border border-neutral-200 p-4">
            <h3 className="font-semibold">メンバーシップを共有・管理できるユーザー</h3>
            <div className="mt-2 space-y-2">
              {SHARE_LEVEL_OPTIONS.map((option) => (
                <label
                  key={`share-${option.value}`}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 ${
                    settings?.who_can_share === option.value ? "border-[#4075cf] bg-[#f4f8ff]" : "border-neutral-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="who-can-share"
                    checked={settings?.who_can_share === option.value}
                    disabled={!settings}
                    onChange={() =>
                      setSettings((current) => (current ? { ...current, who_can_share: option.value } : current))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs text-neutral-500">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-lg border border-neutral-200 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">フィールド単位の更新制限</h3>
                <p className="mt-0.5 text-xs text-neutral-500">カスタムフィールドごとに編集できるユーザーを制限します。</p>
              </div>
              <button type="button" onClick={onOpenFields} className={PROJECT_DIALOG_SECONDARY}>
                フィールド設定を開く
              </button>
            </div>
            {customFields.length === 0 ? (
              <p className="mt-3 text-xs text-neutral-400">カスタムフィールドはまだありません。</p>
            ) : (
              <div className="mt-3 max-h-48 overflow-y-auto rounded border border-neutral-100">
                {customFields.map((field) => (
                  <div key={field.id} className="flex items-center gap-2 border-b border-neutral-100 px-3 py-1.5 last:border-b-0">
                    <span className="min-w-0 flex-1 truncate">{field.name}</span>
                    <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                      {accessLabel(field)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <ProjectMembersManager projectId={projectId} />
          <p className="mt-3 text-[11px] text-neutral-400">
            ワークフロー・ステータス・外観などの構成変更と共有操作に適用されます。権限設定の変更と管理者の追加・変更は、プロジェクト管理者に限定されます。タスクやコメントの編集権限は変わりません。
          </p>
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-6 py-3">
          <button type="button" className={PROJECT_DIALOG_SECONDARY} onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className={PROJECT_DIALOG_PRIMARY} onClick={() => void save()} disabled={!settings || saving}>
            {saving ? "保存中…" : "権限を保存"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
