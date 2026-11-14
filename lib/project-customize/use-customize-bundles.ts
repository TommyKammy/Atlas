"use client";

import { useState } from "react";
import { api } from "../api-client";
import type { ProjectRule } from "../automation/types";
import type { Bundle, BundleField } from "../bundles";
import { confirmAction } from "../ui-feedback";
import type { CustomizeContext } from "./context";

export function useCustomizeBundles({ projectId, canConfigure, canAdmin, setBusy, notify, refresh, initialBundles, initialRules }: CustomizeContext & { initialBundles: Bundle[]; initialRules: ProjectRule[] }) {
  const [bundleDraft, setBundleDraft] = useState<{
    name: string;
    description: string;
    fields: BundleField[];
    ruleIds: number[];
  } | null>(null);
  const applyBundle = async (bundle: Bundle) => {
    if (!canConfigure) return;
    setBusy(true);
    try {
      const result = await api<{ created_fields: number }>(`/api/bundles/${bundle.id}/apply`, "POST", { project_id: projectId });
      refresh();
      notify(
        result.created_fields > 0
          ? `バンドルを適用し、${result.created_fields}件のフィールドを追加しました`
          : "バンドルは適用済みです",
      );
    } catch {
      notify("バンドルの適用に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const saveBundle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bundleDraft || !canAdmin) return;
    if (!bundleDraft.name.trim() || bundleDraft.fields.some((field) => !field.name.trim())) {
      notify("バンドル名とフィールド名を入力してください");
      return;
    }
    setBusy(true);
    try {
      await api("/api/bundles", "POST", {
        workspace_id: initialBundles[0]?.workspace_id ?? 1,
        name: bundleDraft.name.trim(),
        description: bundleDraft.description.trim(),
        fields: bundleDraft.fields,
        rules: initialRules
          .filter((rule) => bundleDraft.ruleIds.includes(rule.id))
          .map((rule) => ({
            name: rule.name,
            description: rule.description,
            definition: rule.definition,
            enabled: rule.enabled,
          })),
      });
      setBundleDraft(null);
      refresh();
      notify("バンドルを作成しました");
    } catch {
      notify("バンドルの作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const removeBundle = async (bundle: Bundle) => {
    if (!canAdmin || !await confirmAction(`「${bundle.name}」バンドルを削除しますか？`)) return;
    try {
      await api(`/api/bundles/${bundle.id}`, "DELETE");
      refresh();
      notify("バンドルを削除しました");
    } catch {
      notify("バンドルの削除に失敗しました");
    }
  };

  return { bundleDraft, setBundleDraft, applyBundle, saveBundle, removeBundle };
}
