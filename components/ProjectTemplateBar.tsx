"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { api } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Project } from "@/lib/data";


export default function ProjectTemplateBar({
  workspaceId,
  projects,
  initial,
}: {
  workspaceId: number;
  projects: Project[];
  initial: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initial);
  const [tpl, setTpl] = useState("");
  const [newName, setNewName] = useState("");
  const [snapProject, setSnapProject] = useState("");
  const [snapName, setSnapName] = useState("");

  const reload = async () => {
    const res = await fetch(`/api/project-templates?workspace_id=${workspaceId}`);
    if (res.ok) setTemplates(await res.json());
  };

  const instantiate = async () => {
    if (!tpl || !newName.trim()) return;
    const { id } = await api<{ id: number }>(`/api/project-templates/${tpl}`, "POST", { name: newName.trim() });
    router.push(`/projects/${id}?view=list`);
    router.refresh();
  };

  const snapshot = async () => {
    if (!snapProject || !snapName.trim()) return;
    await api("/api/project-templates", "POST", { project_id: Number(snapProject), name: snapName.trim() });
    setSnapName("");
    reload();
  };

  const remove = async () => {
    if (!tpl) return;
    if (!await confirmAction("プロジェクトテンプレートを削除しますか？")) return;
    await api(`/api/project-templates/${tpl}`, "DELETE");
    setTpl("");
    reload();
  };

  const field = "rounded border px-2 py-1.5 text-sm outline-none focus:border-blue-500";
  return (
    <div className="mt-6 max-w-3xl rounded-lg border p-4">
      <h2 className="font-semibold">プロジェクトテンプレート</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <select value={tpl} onChange={(e) => setTpl(e.target.value)} className="rounded border px-2 py-1.5">
          <option value="">選択…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新規プロジェクト名"
          className={`${field} w-48`}
        />
        <button onClick={instantiate} className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700">
          テンプレートから作成
        </button>
        {tpl && (
          <button onClick={remove} className="text-neutral-400 hover:text-red-600" title="テンプレートを削除">
            ×
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
        <span className="text-neutral-500">既存取込：</span>
        <select value={snapProject} onChange={(e) => setSnapProject(e.target.value)} className="rounded border px-2 py-1.5">
          <option value="">プロジェクト…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          value={snapName}
          onChange={(e) => setSnapName(e.target.value)}
          placeholder="テンプレート名"
          className={`${field} w-48`}
        />
        <button onClick={snapshot} className="rounded border px-3 py-1.5 hover:bg-neutral-50">
          保存
        </button>
      </div>
    </div>
  );
}
