"use client";

import { useEffect, useState } from "react";
import ProjectMembersManager from "./ProjectMembersManager";
import ShareLinks from "./ShareLinks";
import Dialog from "./ui/Dialog";

export default function ProjectShareButton({
  projectId,
  projectName,
  label = "共有",
}: {
  projectId: number;
  projectName: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setOrigin(window.location.origin));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/projects/${projectId}?view=list`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-project-share
        onClick={() => setOpen(true)}
        className="flex h-7 items-center rounded-md bg-[#4075cf] px-2.5 text-xs text-white hover:bg-[#3567b8]"
      >
        {label}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        titleId="project-share-title"
        backdropClassName="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4"
        panelClassName="max-h-[90vh] w-[min(560px,92vw)] overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 id="project-share-title" className="text-lg font-semibold">
              {projectName}を共有
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">メンバーと閲覧リンクを管理します。</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xl leading-none text-neutral-400 hover:text-neutral-700"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <input
            readOnly
            value={`${origin}/projects/${projectId}?view=list`}
            className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 text-xs text-neutral-600"
          />
          <button
            type="button"
            onClick={copy}
            className="h-8 shrink-0 rounded-md border border-neutral-200 px-3 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            {copied ? "コピー済み" : "コピー"}
          </button>
        </div>

        <ProjectMembersManager projectId={projectId} />
        <ShareLinks projectId={projectId} />

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md bg-[#4075cf] px-4 py-1.5 text-sm text-white hover:bg-[#3567b8]"
          >
            完了
          </button>
        </div>
      </Dialog>
    </>
  );
}
