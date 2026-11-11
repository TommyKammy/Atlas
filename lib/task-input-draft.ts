export type TaskInputRecovery = {
  taskId: number;
  revision: number;
  updatedAt: string;
  values: Record<string, string | number | boolean | null>;
};

export type TaskInputSource = {
  taskId: number;
  value: string;
  updatedAt: string;
  recovery?: { revision: number; value: string; updatedAt: string };
};

export type TaskInputDraft = {
  taskId: number;
  value: string;
  baseValue: string;
  baseUpdatedAt: string;
  observedValue: string;
  observedUpdatedAt: string;
  recoveryRevision: number;
};

export function createTaskInputDraft(source: TaskInputSource): TaskInputDraft {
  return {
    taskId: source.taskId,
    value: source.recovery?.value ?? source.value,
    baseValue: source.recovery?.value ?? source.value,
    baseUpdatedAt: source.recovery?.updatedAt ?? source.updatedAt,
    observedValue: source.value,
    observedUpdatedAt: source.updatedAt,
    recoveryRevision: source.recovery?.revision ?? 0,
  };
}

/** Keep an edit's original lock stamp until saved or explicitly discarded. */
export function reconcileTaskInputDraft(draft: TaskInputDraft, source: TaskInputSource): TaskInputDraft {
  const revision = source.recovery?.revision ?? 0;
  if (draft.taskId !== source.taskId || draft.recoveryRevision !== revision) {
    return createTaskInputDraft(source);
  }
  if (draft.observedUpdatedAt === source.updatedAt && draft.observedValue === source.value) return draft;
  if (draft.value === draft.baseValue || draft.value === source.value) {
    return {
      ...createTaskInputDraft({ ...source, recovery: undefined }),
      recoveryRevision: revision,
    };
  }
  return { ...draft, observedValue: source.value, observedUpdatedAt: source.updatedAt };
}
