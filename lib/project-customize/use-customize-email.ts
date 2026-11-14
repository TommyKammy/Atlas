"use client";

import { useState } from "react";
import { api } from "../api-client";
import type { CustomizeContext } from "./context";

export function useCustomizeEmail({ projectId, canConfigure, setBusy, notify, initialEmailAddress, initialEmailEnabled }: CustomizeContext & { initialEmailAddress: string | null; initialEmailEnabled: boolean }) {
  const [emailAddress, setEmailAddress] = useState(initialEmailAddress ?? "");
  const [emailEnabled, setEmailEnabled] = useState(initialEmailEnabled);
  const [emailCopied, setEmailCopied] = useState(false);
  const updateEmail = async (patch: { enabled?: boolean; regenerate?: boolean }) => {
    if (!canConfigure) return;
    setBusy(true);
    try {
      const next = await api<{ address?: string | null; enabled?: boolean }>(`/api/projects/${projectId}/email`, "PATCH", patch);
      setEmailAddress(next.address ?? emailAddress);
      setEmailEnabled(next.enabled !== false);
      notify(patch.regenerate ? "メールアドレスを再生成しました" : "メール設定を更新しました");
    } catch {
      notify("メール設定の更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const copyEmail = async () => {
    if (!emailAddress) return;
    try {
      await navigator.clipboard.writeText(emailAddress);
      setEmailCopied(true);
      window.setTimeout(() => setEmailCopied(false), 1600);
    } catch {
      notify("コピーに失敗しました");
    }
  };

  return { emailAddress, setEmailAddress, emailEnabled, setEmailEnabled, emailCopied, updateEmail, copyEmail };
}
