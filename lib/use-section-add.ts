"use client";

import { useRef, useState } from "react";
import { api } from "./api-client";

/** Shared save/cancel behavior; keep typing local to the section composer. */
export function useSectionAdd(projectId: number, onCreated: (sectionId: number) => void) {
  const submitting = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const name = draft?.trim();
    if (!name || submitting.current) return;
    // A ref closes the gap before React renders the disabled controls.
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      const created = await api<{ id: number | string }>("/api/sections", "POST", { project_id: projectId, name });
      setDraft(null);
      onCreated(Number(created.id));
    } catch {
      setError("セクションの追加に失敗しました。もう一度お試しください。");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return {
    adding: draft !== null,
    name: draft ?? "",
    saving,
    error,
    onNameChange: (name: string) => {
      setDraft(name);
      setError(null);
    },
    onCreate: () => void create(),
    onCancel: () => {
      if (submitting.current) return;
      setDraft(null);
      setError(null);
    },
    onStart: () => {
      if (submitting.current) return;
      setError(null);
      setDraft((current) => current ?? "");
    },
  };
}
