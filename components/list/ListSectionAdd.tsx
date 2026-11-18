"use client";

import { isImeComposing } from "@/lib/ime-keyboard";
import { useEffect, useId, useRef } from "react";

/** Shared inline section composer for list groups, board columns and timeline. */
export default function ListSectionAdd({
  adding,
  name,
  onNameChange,
  onCreate,
  onCancel,
  onStart,
  compact = false,
  saving = false,
  error = null,
}: {
  adding: boolean;
  name: string;
  onNameChange: (value: string) => void;
  onCreate: () => void;
  onCancel: () => void;
  onStart: () => void;
  compact?: boolean;
  saving?: boolean;
  error?: string | null;
}) {
  const startRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const wasAdding = useRef(adding);
  useEffect(() => {
    const restoreFocus = wasAdding.current && !adding;
    wasAdding.current = adding;
    if (!restoreFocus) return;
    // Global Escape handlers may blur the active control during the same event.
    const frame = requestAnimationFrame(() => startRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [adding]);

  return (
    <div className={compact ? "px-3 pb-3 pt-2" : "pt-4"} id={compact ? undefined : "custom-field-add"}>
      {adding ? (
        <div className={compact ? "flex min-w-0 flex-wrap gap-2" : "flex gap-2"} aria-busy={saving}>
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            data-add-section-input
            aria-label="セクション名"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            disabled={saving}
            onKeyDown={(event) => {
              if (isImeComposing(event) || saving) return;
              if (event.key === "Enter") {
                event.preventDefault();
                onCreate();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
              }
            }}
            placeholder="セクション名"
            autoFocus
            className={`${compact ? "w-full min-w-0 " : ""}rounded border px-2 py-1 text-sm outline-none focus:border-accent disabled:bg-surface-subtle`}
          />
          <button
            type="button"
            onClick={onCreate}
            disabled={saving}
            className={`rounded bg-accent py-1 text-on-accent hover:bg-accent-hover disabled:opacity-50 ${compact ? "px-2 text-xs" : "px-3 text-sm"}`}
          >
            {saving ? "追加中…" : "追加"}
          </button>
          <button type="button" onClick={onCancel} disabled={saving} className={`text-muted disabled:opacity-50 ${compact ? "px-1 text-xs" : "px-2 text-sm"}`}>
            キャンセル
          </button>
          {error && <p id={errorId} role="alert" className="w-full text-sm text-danger">{error}</p>}
        </div>
      ) : (
        <button type="button" ref={startRef} onClick={onStart} className="text-left text-sm text-muted hover:text-text">
          ＋ セクションを追加
        </button>
      )}
    </div>
  );
}
