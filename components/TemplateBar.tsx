"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { api } from "@/lib/api-client";
import { useEffect, useState } from "react";
import type { Section, TaskTemplate, User } from "@/lib/data";
import { useApiRefresh } from "@/lib/use-api-refresh";


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
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => window.cancelAnimationFrame(frame);
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
    if (!await confirmAction("テンプレートを削除しますか？")) return;
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

  const field = "rounded border px-2 py-1 text-sm outline-none focus:border-accent";
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-1.5 text-sm">
      <span className="text-muted">テンプレート</span>
      <select
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        aria-label="テンプレートを選択"
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
        aria-label="選択したテンプレートからタスクを作成"
        className="rounded bg-accent px-2 py-0.5 text-on-accent disabled:opacity-40"
      >
        使う
      </button>
      {picked && (
        <button onClick={remove} className="text-subtle hover:text-danger" title="テンプレートを削除">
          ×
        </button>
      )}
      {forming ? (
        <span className="flex flex-wrap items-center gap-1">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="テンプレート名" aria-label="テンプレート名" className={`${field} w-32`} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タスク名" aria-label="テンプレートのタスク名" className={`${field} w-40`} />
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="テンプレートの担当者" className="rounded border px-1 py-1 text-sm">
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
            aria-label="期日オフセット"
            className={`${field} w-24`}
          />
          <input value={subs} onChange={(e) => setSubs(e.target.value)} placeholder="サブタスク（カンマ区切り）" aria-label="サブタスク" className={`${field} w-48`} />
          <button onClick={create} aria-label="テンプレートを保存" className="rounded bg-accent px-2 py-0.5 text-on-accent">
            保存
          </button>
          <button onClick={() => setForming(false)} aria-label="テンプレート作成をキャンセル" className="text-muted">
            ×
          </button>
        </span>
      ) : (
        <button onClick={() => setForming(true)} aria-label="テンプレートを新規作成" className="text-secondary hover:text-text">
          ＋ 新規
        </button>
      )}
    </div>
  );
}
