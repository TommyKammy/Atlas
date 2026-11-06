"use client";

import { useEffect, useState } from "react";
import type { Section, TaskTemplate, User } from "@/lib/data";
import { useApiRefresh } from "./ListView";

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.json();
}

export default function TemplateBar({
  projectId,
  sections,
  users,
}: {
  projectId: number;
  sections: Section[];
  users: User[];
}) {
  const refresh = useApiRefresh();
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [picked, setPicked] = useState("");
  const [forming, setForming] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [offset, setOffset] = useState("");
  const [subs, setSubs] = useState("");

  const load = async () => {
    const res = await fetch(`/api/task-templates?project_id=${projectId}`);
    if (res.ok) setTemplates(await res.json());
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const instantiate = async () => {
    if (!picked) return;
    await api(`/api/task-templates/${picked}`, "POST", {});
    setPicked("");
    refresh();
  };

  const remove = async () => {
    if (!picked) return;
    if (!confirm("テンプレートを削除しますか？")) return;
    await api(`/api/task-templates/${picked}`, "DELETE");
    setPicked("");
    load();
    refresh();
  };

  const create = async () => {
    if (!name.trim() || !title.trim()) return;
    await api("/api/task-templates", "POST", {
      project_id: projectId,
      name: name.trim(),
      title_template: title.trim(),
      assignee_id: assignee === "" ? null : Number(assignee),
      due_offset_days: offset === "" ? null : Number(offset),
      section_id: sections[0]?.id ?? null,
      subtasks: subs
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
        .map((s) => ({ name: s })),
    });
    setName("");
    setTitle("");
    setAssignee("");
    setOffset("");
    setSubs("");
    setForming(false);
    load();
  };

  const field = "rounded border px-2 py-1 text-sm outline-none focus:border-blue-500";
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-1.5 text-sm">
      <span className="text-neutral-500">テンプレート</span>
      <select
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className="rounded border px-1 py-0.5"
      >
        <option value="">選択…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button
        onClick={instantiate}
        disabled={!picked}
        className="rounded bg-blue-600 px-2 py-0.5 text-white disabled:opacity-40"
      >
        使う
      </button>
      {picked && (
        <button onClick={remove} className="text-neutral-400 hover:text-red-600" title="テンプレートを削除">
          ×
        </button>
      )}
      {forming ? (
        <span className="flex flex-wrap items-center gap-1">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="テンプレート名" className={`${field} w-32`} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タスク名" className={`${field} w-40`} />
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded border px-1 py-1 text-sm">
            <option value="">担当者なし</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            placeholder="期日+N日"
            inputMode="numeric"
            className={`${field} w-24`}
          />
          <input value={subs} onChange={(e) => setSubs(e.target.value)} placeholder="サブタスク（カンマ区切り）" className={`${field} w-48`} />
          <button onClick={create} className="rounded bg-blue-600 px-2 py-0.5 text-white">
            保存
          </button>
          <button onClick={() => setForming(false)} className="text-neutral-500">
            ×
          </button>
        </span>
      ) : (
        <button onClick={() => setForming(true)} className="text-neutral-600 hover:text-black">
          ＋ 新規
        </button>
      )}
    </div>
  );
}
