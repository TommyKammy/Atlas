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
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex h-7 shrink-0 items-center justify-center rounded-md bg-[#4075cf] px-2.5 text-xs whitespace-nowrap text-white hover:bg-[#3567b8] md:@max-[700px]:w-7 md:@max-[700px]:px-0"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="hidden h-3.5 w-3.5 shrink-0 md:@max-[700px]:block"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        >
          <circle cx="6" cy="8" r="2.2" />
          <path d="M8 7.2 12 5M8 8.8 12 11" />
          <circle cx="12.5" cy="4.5" r="1.6" />
          <circle cx="12.5" cy="11.5" r="1.6" />
        </svg>
        <span className="md:@max-[700px]:hidden">{label}</span>
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
