"use client";

import { useState } from "react";
import ProjectShareDialog from "./project/ProjectShareDialog";

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

  return (
    <>
      <button
        type="button"
        data-project-share
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex h-7 shrink-0 items-center rounded-md bg-[#4075cf] px-2.5 text-xs whitespace-nowrap text-white hover:bg-[#3567b8]"
      >
        {label}
      </button>
      {open && (
        <ProjectShareDialog
          projectId={projectId}
          projectName={projectName}
          title={`${projectName}を共有`}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
