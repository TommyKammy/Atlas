"use client";

import { useState } from "react";
import { api } from "../api-client";
import { APP_CATALOG, type ProjectApp } from "../integrations";
import { confirmAction } from "../ui-feedback";
import type { CustomizeContext } from "./context";

export function useCustomizeApps({ projectId, canConfigure, setBusy, notify, refresh }: CustomizeContext) {
  const [appDraft, setAppDraft] = useState<{ app_key: string; config: Record<string, string> } | null>(null);
  const installApp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!appDraft || !canConfigure) return;
    const definition = APP_CATALOG.find((app) => app.key === appDraft.app_key);
    if (!definition) return;
    const missing = definition.fields.find(
      (field) => field.required && !(appDraft.config[field.key] ?? "").trim(),
    );
    if (missing) {
      notify(`${missing.label}を入力してください`);
      return;
    }
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/apps`, "POST", appDraft);
      setAppDraft(null);
      refresh();
      notify("アプリを追加しました");
    } catch {
      notify("アプリの追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const toggleApp = async (app: ProjectApp) => {
    if (!canConfigure) return;
    try {
      await api(`/api/projects/${projectId}/apps/${app.id}`, "PATCH", { enabled: !app.enabled });
      refresh();
    } catch {
      notify("アプリの更新に失敗しました");
    }
  };

  const removeApp = async (app: ProjectApp) => {
    if (!canConfigure || !await confirmAction("このアプリ連携を削除しますか？")) return;
    try {
      await api(`/api/projects/${projectId}/apps/${app.id}`, "DELETE");
      refresh();
      notify("アプリを削除しました");
    } catch {
      notify("アプリの削除に失敗しました");
    }
  };

  return { appDraft, setAppDraft, installApp, toggleApp, removeApp };
}
