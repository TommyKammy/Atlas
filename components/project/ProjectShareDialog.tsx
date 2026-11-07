"use client";

import Dialog from "../ui/Dialog";
import ProjectMembersManager from "../ProjectMembersManager";
import ShareLinks from "../ShareLinks";
import { toast } from "@/lib/ui-feedback";

/** Project share dialog used from the sidebar context menu. */
export default function ProjectShareDialog({
  projectId,
  projectName,
  onClose,
}: {
  projectId: number;
  projectName: string;
  onClose: () => void;
}) {
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/projects/${projectId}?view=list`;
  const primary =
    "flex h-8 items-center rounded-md bg-[#4075cf] px-3 text-sm font-medium text-white hover:bg-[#3567b8] disabled:opacity-60";
  const secondary =
    "flex h-8 items-center rounded-md border bg-white px-3 text-sm text-neutral-700 hover:bg-neutral-50";
  return (
    <Dialog
      open
      onClose={onClose}
      title="プロジェクトを共有"
      backdropClassName="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4"
      panelClassName="max-h-[90vh] w-[min(560px,90vw)] overflow-y-auto rounded-lg bg-white text-sm shadow-xl"
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">プロジェクトを共有</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-xl leading-none text-neutral-400 hover:text-neutral-700"
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">{projectName}</p>
        <div className="mt-4 flex items-center gap-2">
          <input
            readOnly
            value={url}
            className="h-8 min-w-0 flex-1 rounded-md border bg-neutral-50 px-2 text-xs text-neutral-600"
          />
          <button
            type="button"
            className={secondary}
            onClick={() =>
              navigator.clipboard
                ?.writeText(url)
                .then(() => toast("リンクをコピーしました"))
                .catch(() => toast("リンクをコピーできませんでした"))
            }
          >
            コピー
          </button>
        </div>
        <ProjectMembersManager projectId={projectId} />
        <ShareLinks projectId={projectId} />
        <div className="mt-5 flex justify-end">
          <button type="button" className={primary} onClick={onClose}>
            完了
          </button>
        </div>
      </div>
    </Dialog>
  );
}
