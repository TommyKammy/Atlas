"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { api } from "@/lib/api-client";
import ListSectionAdd from "../list/ListSectionAdd";

export type TimelineSectionAddHandle = { start: () => void };

/** Keep typing in the section composer from re-rendering the timeline's bars. */
export default function TimelineSectionAdd({
  projectId,
  onCreated,
  ref,
}: {
  projectId: number;
  onCreated: () => void;
  ref: Ref<TimelineSectionAddHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    if (submitting.current) return;
    setError(null);
    setDraft((current) => current ?? "");
    containerRef.current?.querySelector<HTMLInputElement>("[data-add-section-input]")?.focus();
  };
  useImperativeHandle(ref, () => ({ start }));

  const create = async () => {
    const name = draft?.trim();
    if (!name || submitting.current) return;
    // A ref closes the gap before React renders the disabled controls.
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      await api("/api/sections", "POST", { project_id: projectId, name });
      setDraft(null);
      onCreated();
    } catch {
      setError("セクションの追加に失敗しました。もう一度お試しください。");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return (
    <div ref={containerRef} data-timeline-section-add>
      <ListSectionAdd
        compact
        adding={draft !== null}
        name={draft ?? ""}
        saving={saving}
        error={error}
        onNameChange={(name) => {
          setDraft(name);
          setError(null);
        }}
        onCreate={() => void create()}
        onCancel={() => {
          if (submitting.current) return;
          setDraft(null);
          setError(null);
        }}
        onStart={start}
      />
    </div>
  );
}
