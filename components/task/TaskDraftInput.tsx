"use client";

import { useState, useSyncExternalStore } from "react";
import { createTaskInputDraft, reconcileTaskInputDraft, type TaskInputRecovery } from "@/lib/task-input-draft";
import { isImeComposing } from "@/lib/ime-keyboard";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** Title/progress drafts survive refreshes and reset only on explicit recovery. */
export default function TaskDraftInput({ taskId, field, value, updatedAt, recovery, onSave, label, className, placeholder, type = "text", min, max, enterBlurs = false, normalize = (value) => value, readOnly = false }: {
  taskId: number;
  field: "name" | "progress";
  value: string | number;
  updatedAt: string;
  recovery: TaskInputRecovery | null;
  onSave: (value: string, expectedUpdatedAt: string) => void | Promise<void>;
  label: string;
  className: string;
  placeholder?: string;
  type?: "text" | "number";
  min?: number;
  max?: number;
  enterBlurs?: boolean;
  normalize?: (value: string) => string;
  readOnly?: boolean;
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const restored = recovery?.taskId === taskId ? recovery : null;
  const source = {
    taskId,
    value: String(value),
    updatedAt,
    ...(restored ? { recovery: {
      revision: restored.revision,
      value: String(restored.values[field] ?? value),
      updatedAt: restored.updatedAt,
    } } : {}),
  };
  const [draft, setDraft] = useState(() => createTaskInputDraft(source));
  const current = reconcileTaskInputDraft(draft, source);
  if (current !== draft) setDraft(current);

  return (
    <input
      type={type}
      min={min}
      max={max}
      value={current.value}
      readOnly={readOnly || !ready}
      aria-label={label}
      data-task-draft-field={field}
      data-task-draft-ready={ready ? "true" : "false"}
      placeholder={placeholder}
      className={className}
      onChange={(event) => { if (!readOnly) setDraft({ ...current, value: event.target.value }); }}
      onBlur={(event) => {
        if (readOnly) return;
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-task-conflict-discard], [data-task-save-control]")) return;
        if (current.value === current.baseValue) return;
        const normalized = normalize(current.value);
        if (normalized !== current.value) setDraft({ ...current, value: normalized });
        if (normalized !== current.baseValue) void onSave(normalized, current.baseUpdatedAt);
      }}
      onKeyDown={enterBlurs ? (event) => !isImeComposing(event) && event.key === "Enter" && event.currentTarget.blur() : undefined}
    />
  );
}
