"use client";

import { useState } from "react";
import type { TemplateDraft } from "../../components/customize/CustomizeTemplateModal";
import { api } from "../api-client";
import type { TaskTemplate } from "../data";
import { confirmAction } from "../ui-feedback";
export async function fetchTemplates(projectId: number): Promise<TaskTemplate[]> {
  const res = await fetch(`/api/task-templates?project_id=${projectId}`);
  return res.ok ? res.json() : [];
}


import type { CustomizeContext } from "./context";

export function useCustomizeTemplates({ projectId, canConfigure, canEdit, setBusy, notify, refresh }: CustomizeContext) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const saveTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!templateDraft || !canConfigure) return;
    if (!templateDraft.name.trim() || !templateDraft.title.trim()) {
      notify("テンプレート名とタスク名を入力してください");
      return;
    }
    setBusy(true);
    const payload = {
      name: templateDraft.name.trim(),
      title_template: templateDraft.title.trim(),
      assignee_id: templateDraft.assignee === "" ? null : Number(templateDraft.assignee),
      due_offset_days: templateDraft.offset === "" ? null : Number(templateDraft.offset),
      section_id: templateDraft.section === "" ? null : Number(templateDraft.section),
      subtasks: templateDraft.subtasks
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
    };
    try {
      if (templateDraft.id === null) {
        await api("/api/task-templates", "POST", { project_id: projectId, ...payload });
        notify("テンプレートを追加しました");
      } else {
        await api(`/api/task-templates/${templateDraft.id}`, "PATCH", payload);
        notify("テンプレートを更新しました");
      }
      setTemplates(await fetchTemplates(projectId));
      setTemplateDraft(null);
    } catch {
      notify("テンプレートの保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const instantiateTemplate = async (template: TaskTemplate) => {
    if (!canEdit) return;
    try {
      await api(`/api/task-templates/${template.id}`, "POST", {});
      refresh();
      notify(`「${template.name}」からタスクを作成しました`);
    } catch {
      notify("タスクの作成に失敗しました");
    }
  };

  const removeTemplate = async (template: TaskTemplate) => {
    if (!canConfigure) return;
    if (!await confirmAction(`テンプレート「${template.name}」を削除しますか？`)) return;
    try {
      await api(`/api/task-templates/${template.id}`, "DELETE");
      setTemplates(await fetchTemplates(projectId));
      notify("テンプレートを削除しました");
    } catch {
      notify("テンプレートの削除に失敗しました");
    }
  };

  return { templates, setTemplates, templateDraft, setTemplateDraft, saveTemplate, instantiateTemplate, removeTemplate };
}
