"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "../api-client";
import { confirmAction } from "../ui-feedback";
import type { CustomizePanel } from "../use-project-customize";
type StatusDraft = {
  key: number;
  original: string | null;
  value: string;
};

type StatusOptionsConflict = {
  status_options: string[];
  status_options_version: number;
  status_field_name: string;
  status_field_enabled: boolean;
};


import type { CustomizeContext } from "./context";

export function useCustomizeStatus({ projectId, canConfigure, busy, setBusy, notify, refresh,
  initialColor, initialIcon, initialStatusOptions, initialStatusOptionsVersion, initialStatusFieldName, initialStatusFieldEnabled, setPanel,
}: CustomizeContext & {
  initialColor: string | null; initialIcon: string | null;
  initialStatusOptions: string[]; initialStatusOptionsVersion: number;
  initialStatusFieldName: string; initialStatusFieldEnabled: boolean;
  setPanel: (panel: CustomizePanel) => void;
}) {
  const [color, setColor] = useState<string | null>(initialColor);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [statusFieldName, setStatusFieldName] = useState(initialStatusFieldName);
  const [statusFieldEnabled, setStatusFieldEnabled] = useState(initialStatusFieldEnabled);
  const [statusOptionsVersion, setStatusOptionsVersion] = useState(initialStatusOptionsVersion);
  const [statusDrafts, setStatusDrafts] = useState<StatusDraft[]>(() =>
    initialStatusOptions.map((option, index) => ({ key: index, original: option, value: option })),
  );
  const statusKey = useRef(initialStatusOptions.length);
  const statusValues = statusDrafts.map((draft) => draft.value.trim()).filter(Boolean);

  const saveAppearance = async (patch: { color?: string | null; icon?: string | null }) => {
    if (!canConfigure || busy) return;
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}`, "PATCH", patch);
      if ("color" in patch) setColor(patch.color ?? null);
      if ("icon" in patch) setIcon(patch.icon ?? null);
      refresh();
      notify("カラーとアイコンを更新しました");
    } catch {
      notify("外観の更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const saveStatusOptions = async () => {
    if (!canConfigure || busy) return;
    const name = statusFieldName.trim() || "Status";
    const options = statusValues;
    if (options.length === 0) {
      notify("ステータスを1つ以上入力してください");
      return;
    }
    const renames = statusDrafts
      .filter((draft) => draft.original !== null && draft.value.trim() !== "" && draft.original !== draft.value.trim())
      .map((draft) => ({ from: draft.original!, to: draft.value.trim() }));
    setBusy(true);
    try {
      const saved = await api<{ status_options_version: number }>(`/api/projects/${projectId}`, "PATCH", {
        status_field_name: name,
        status_field_enabled: true,
        status_options: options,
        status_renames: renames,
        expected_status_options_version: statusOptionsVersion,
      });
      setStatusOptionsVersion(saved.status_options_version);
      setStatusFieldName(name);
      setStatusFieldEnabled(true);
      setStatusDrafts((current) =>
        current
          .filter((draft) => draft.value.trim() !== "")
          .map((draft) => ({ ...draft, original: draft.value.trim(), value: draft.value.trim() })),
      );
      refresh();
      notify("ステータスフィールドを更新しました");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = error.body as StatusOptionsConflict;
        setStatusOptionsVersion(current.status_options_version);
        setStatusFieldName(current.status_field_name);
        setStatusFieldEnabled(current.status_field_enabled);
        setStatusDrafts(current.status_options.map((option, index) => ({ key: index, original: option, value: option })));
        statusKey.current = current.status_options.length;
        refresh();
        notify("別の操作でステータスが更新されました。最新の選択肢を確認してから編集してください");
      } else {
        notify("ステータスの更新に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const deleteStatusField = async () => {
    if (!canConfigure) return;
    if (!await confirmAction(`「${statusFieldName}」フィールドを削除しますか？タスクの値は保持されます。`)) return;
    try {
      await api(`/api/projects/${projectId}`, "PATCH", { status_field_enabled: false });
      setStatusFieldEnabled(false);
      setPanel("fields");
      refresh();
      notify("ステータスフィールドを削除しました");
    } catch {
      notify("ステータスフィールドの削除に失敗しました");
    }
  };

  const restoreStatusField = async () => {
    if (!canConfigure) return;
    try {
      await api(`/api/projects/${projectId}`, "PATCH", { status_field_enabled: true });
      setStatusFieldEnabled(true);
      refresh();
      notify("ステータスフィールドを追加しました");
    } catch {
      notify("ステータスフィールドの追加に失敗しました");
    }
  };

  return { color, icon, statusFieldName, setStatusFieldName, statusFieldEnabled, statusDrafts, setStatusDrafts, statusKey, statusValues, saveAppearance, saveStatusOptions, deleteStatusField, restoreStatusField };
}
