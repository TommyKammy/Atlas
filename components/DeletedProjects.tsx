"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { confirmAction, toast } from "@/lib/ui-feedback";
import { smallDangerButtonClass, smallSecondaryButtonClass } from "./ui/form-controls";

type DeletedProject = {
  id: number;
  name: string;
  deleted_at: string;
  deleted_by_name: string;
  can_manage: boolean;
  task_count: number;
};

export default function DeletedProjects({ initial }: { initial: DeletedProject[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  const restore = async (id: number) => {
    setBusy(id);
    try {
      await api(`/api/projects/${id}/restore`, "POST");
      toast("プロジェクトを復元しました");
      router.refresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "復元に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  const purge = async (project: DeletedProject) => {
    if (!(await confirmAction(`「${project.name}」を完全に削除しますか？この操作は元に戻せません。`))) return;
    setBusy(project.id);
    try {
      await api(`/api/projects/${project.id}/trash`, "DELETE");
      toast("プロジェクトを完全に削除しました");
      router.refresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "削除に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  if (initial.length === 0) {
    return <p className="mt-2 rounded-lg bg-surface-subtle px-3 py-2 text-[13px] text-muted">削除済みのプロジェクトはありません。</p>;
  }
  return (
    <div className="mt-2" data-deleted-projects>
      {initial.map((project) => (
        <div key={project.id} className="flex min-h-[40px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-subtle px-1 py-1 hover:bg-hover">
          <span className="min-w-0 w-full truncate text-[13px] text-text sm:w-auto sm:flex-1">{project.name}</span>
          <span className="shrink-0 text-[12px] text-muted">
            {project.deleted_at.slice(0, 10)}
            {project.deleted_by_name ? ` ・ ${project.deleted_by_name}` : ""}
          </span>
          <span className="shrink-0 text-[12px] tabular-nums text-muted">{project.task_count}タスク</span>
          <button
            type="button"
            onClick={() => void restore(project.id)}
            disabled={!project.can_manage || busy === project.id}
            className={smallSecondaryButtonClass}
          >
            復元
          </button>
          <button
            type="button"
            onClick={() => void purge(project)}
            disabled={!project.can_manage || busy === project.id}
            className={smallDangerButtonClass}
          >
            完全に削除
          </button>
        </div>
      ))}
    </div>
  );
}
