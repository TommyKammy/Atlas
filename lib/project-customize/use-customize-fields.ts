"use client";

import { useState } from "react";
import type { FieldDraft } from "../../components/customize/CustomizeFieldModal";
import { FIELD_LIBRARY } from "../../components/customize/field-library";
import { api } from "../api-client";
import type { CustomField } from "../custom-fields";
import { confirmAction } from "../ui-feedback";
export async function fetchFields(projectId: number): Promise<CustomField[]> {
  const res = await fetch(`/api/custom-fields?project_id=${projectId}`);
  return res.ok ? res.json() : [];
}


import type { CustomizeContext } from "./context";

export function useCustomizeFields({ projectId, canConfigure, busy, setBusy, notify, refresh, initialFields }: CustomizeContext & { initialFields: CustomField[] }) {
  const [fields, setFields] = useState<CustomField[]>(initialFields);
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);
  const saveField = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!fieldDraft || !canConfigure) return;
    const name = fieldDraft.name.trim();
    if (!name) {
      notify("フィールド名を入力してください");
      return;
    }
    const options =
      fieldDraft.field_type === "select" || fieldDraft.field_type === "multi_select"
        ? fieldDraft.options.split(/[,\n]/).map((o) => o.trim()).filter(Boolean)
        : [];
    setBusy(true);
    try {
      if (fieldDraft.id === null) {
        await api("/api/custom-fields", "POST", {
          project_id: projectId,
          name,
          field_type: fieldDraft.field_type,
          options,
        });
        notify("フィールドを追加しました");
      } else {
        await api(`/api/custom-fields/${fieldDraft.id}`, "PATCH", { name, options });
        notify("フィールドを更新しました");
      }
      setFields(await fetchFields(projectId));
      setFieldDraft(null);
      refresh();
    } catch {
      notify("フィールドの保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const removeField = async (field: CustomField) => {
    if (!canConfigure) return;
    if (!await confirmAction(`フィールド「${field.name}」を削除しますか？（削除済みフィールドから復元できます）`)) return;
    try {
      await api(`/api/custom-fields/${field.id}`, "DELETE");
      setFields(await fetchFields(projectId));
      refresh();
      notify("フィールドを削除しました");
    } catch {
      notify("フィールドの削除に失敗しました");
    }
  };

  const addLibraryField = async (preset: (typeof FIELD_LIBRARY)[number]) => {
    if (!canConfigure || busy) return;
    if (fields.some((field) => field.name === preset.name)) {
      notify("このフィールドはすでに追加されています");
      return;
    }
    setBusy(true);
    try {
      await api("/api/custom-fields", "POST", {
        project_id: projectId,
        name: preset.name,
        field_type: preset.field_type,
        options: preset.options,
      });
      setFields(await fetchFields(projectId));
      refresh();
      notify(`「${preset.name}」を追加しました`);
    } catch {
      notify("フィールドの追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return { fields, setFields, fieldDraft, setFieldDraft, saveField, removeField, addLibraryField };
}
