export type TaskSavePhase = "saving" | "saved" | "failed" | "conflict";
export type TaskSaveState = {
  id: number;
  key: string;
  label: string;
  phase: TaskSavePhase;
  message?: string;
  retry?: () => void | Promise<void>;
};

/** An older response must not replace a newer edit's state. */
export function updateTaskSaveState(states: Record<string, TaskSaveState>, next: TaskSaveState) {
  const previous = states[next.key];
  if (previous && previous.id > next.id) return states;
  return { ...states, [next.key]: next };
}

export function taskSaveErrorMessage(status: number | null): string {
  if (status === 401) return "ログインの有効期限が切れました。再度ログインしてください。";
  if (status === 403) return "編集権限がありません。入力内容は保持しています。";
  if (status === 404) return "対象が削除されたか、アクセスできなくなりました。";
  if (status === 400 || status === 422) return "入力内容を確認してください。入力内容は保持しています。";
  return "保存結果を確認できませんでした。入力内容は保持しています。通信状態を確認して再試行するか、最新の状態を読み込んでください。";
}
