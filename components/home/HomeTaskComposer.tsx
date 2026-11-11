"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import { useState } from "react";
import { api } from "@/lib/api-client";
import Dialog from "../ui/Dialog";

export default function HomeTaskComposer({
  open,
  mode,
  projects,
  users,
  viewerId,
  onClose,
  onCreated,
}: {
  open: boolean;
  mode: "my_tasks" | "assigned_tasks";
  projects: { id: number; name: string }[];
  users: { id: number; name: string }[];
  viewerId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(String(projects[0]?.id ?? ""));
  const [assigneeId, setAssigneeId] = useState(
    String(users.find((user) => user.id !== viewerId)?.id ?? users[0]?.id ?? viewerId),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (name.trim() === "" || projectId === "") return;
    setBusy(true);
    setError("");
    try {
      await api("/api/tasks", "POST", {
        project_id: Number(projectId),
        name: name.trim(),
        assignee_id:
          mode === "my_tasks" ? viewerId : Number(assigneeId),
      });
      setName("");
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "タスクの作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "my_tasks" ? "タスクを作成" : "タスクを割り当てる"}
      titleId="home-task-composer-title"
      panelClassName="w-[min(460px,94vw)] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
    >
      <div className="p-5">
        <h2 id="home-task-composer-title" className="text-[15px] font-semibold text-neutral-800">
          {mode === "my_tasks" ? "タスクを作成" : "タスクを割り当てる"}
        </h2>
        <div className="mt-3 space-y-2">
          <input
            data-home-composer-name
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => !isImeComposing(event) && event.key === "Enter" && void create()}
            placeholder="タスク名"
            autoFocus
            className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          />
          <select
            data-home-composer-project
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {mode === "assigned_tasks" && (
            <select
              data-home-composer-assignee
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm"
            >
              {users
                .filter((user) => user.id !== viewerId)
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
            </select>
          )}
          {error !== "" && <p className="text-[12px] text-red-600">{error}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            data-home-composer-submit
            disabled={busy || name.trim() === "" || projectId === ""}
            onClick={() => void create()}
            className="rounded-md bg-[#2c60b8] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#24529c] disabled:opacity-50"
          >
            {busy ? "作成中…" : "作成"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
