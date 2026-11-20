"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api-client";
import type { SectionAnchor } from "./section-order";

export type CreatedSection = { id: number; name: string; position: number };
export type SectionCommitOrigin = "enter" | "blur";

/**
 * A section heading is a pure client draft until a non-empty name is
 * committed. The server row is only created on Enter/blur with a name, which
 * keeps an abandoned composer from leaving an "untitled" section behind.
 */
export function useSectionDraft({
  projectId,
  onCreated,
}: {
  projectId: number;
  onCreated?: (
    section: CreatedSection,
    origin: SectionCommitOrigin,
    anchor: SectionAnchor | null,
  ) => void;
}) {
  // `undefined` means no draft; `null` is an explicit "append at the end".
  const [anchor, setAnchor] = useState<SectionAnchor | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const createdRef = useRef(onCreated);

  useEffect(() => {
    createdRef.current = onCreated;
  }, [onCreated]);

  const start = useCallback((next: SectionAnchor | null = null) => {
    if (submitting.current) return;
    setAnchor(next);
    setName("");
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    if (submitting.current) return;
    setAnchor(undefined);
    setName("");
    setError(null);
  }, []);

  const changeName = useCallback((value: string) => {
    setName(value);
    setError((current) => (current ? null : current));
  }, []);

  const commit = useCallback(async (origin: SectionCommitOrigin = "enter") => {
    if (submitting.current || anchor === undefined) return;
    const trimmed = name.trim();
    if (!trimmed) {
      // Atlas discards an untouched section instead of creating "untitled".
      if (origin === "blur") {
        setAnchor(undefined);
        setName("");
        setError(null);
      }
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      const created = await api<CreatedSection>("/api/sections", "POST", {
        project_id: projectId,
        name: trimmed,
        ...(anchor?.before !== undefined ? { before_section_id: anchor.before } : {}),
        ...(anchor?.after !== undefined ? { after_section_id: anchor.after } : {}),
      });
      setAnchor(undefined);
      setName("");
      createdRef.current?.(created, origin, anchor);
    } catch {
      setError("セクションの追加に失敗しました。もう一度お試しください。");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }, [anchor, name, projectId]);

  return {
    active: anchor !== undefined,
    anchor: anchor ?? null,
    name,
    saving,
    error,
    start,
    cancel,
    changeName,
    commit,
  };
}
