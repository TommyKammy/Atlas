"use client";

import { isImeComposing } from "@/lib/ime-keyboard";
import { useEffect, useId, useRef } from "react";

/**
 * The editable name inside an inline section heading. Enter creates, Escape
 * discards an untouched draft, blur commits a non-empty name, and IME
 * conversion confirmation never submits.
 */
export default function SectionDraftInput({
  value,
  onChange,
  onCommit,
  onCancel,
  saving = false,
  error = null,
  className = "",
  errorClassName = "mt-1 w-full text-[12px] text-danger",
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (origin: "enter" | "blur") => void;
  onCancel: () => void;
  saving?: boolean;
  error?: string | null;
  className?: string;
  errorClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusOnError = useRef(false);
  const errorId = useId();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!error || !focusOnError.current) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [error]);

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (isImeComposing(event) || saving) return;
          if (event.key === "Enter") {
            event.preventDefault();
            focusOnError.current = true;
            onCommit("enter");
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            focusOnError.current = false;
            onCancel();
          }
        }}
        onBlur={() => {
          if (saving) return;
          focusOnError.current = false;
          onCommit("blur");
        }}
        disabled={saving}
        aria-label="セクション名"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        aria-busy={saving}
        placeholder="新しいセクション"
        data-add-section-input
        data-section-draft-input
        autoFocus
        className={className}
      />
      {error && (
        <p id={errorId} role="alert" data-section-draft-error className={errorClassName}>
          {error}
        </p>
      )}
    </>
  );
}
