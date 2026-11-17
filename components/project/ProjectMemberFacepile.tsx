"use client";

import { useState } from "react";
import UserAvatar from "../UserAvatar";
import ProjectShareDialog from "./ProjectShareDialog";

type HeaderMember = {
  id: number;
  name: string;
  avatar_url: string | null;
};

const MAX_VISIBLE = 5;

/** Project header member avatars. Mirrors Asana: clicking a member (or the add
 * member placeholder) opens the project share dialog. */
export default function ProjectMemberFacepile({
  projectId,
  projectName,
  members,
}: {
  projectId: number;
  projectName: string;
  members: HeaderMember[];
}) {
  const [open, setOpen] = useState(false);
  const [focusAdd, setFocusAdd] = useState(false);

  const openDialog = (add: boolean) => {
    setFocusAdd(add);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setFocusAdd(false);
  };

  const visible = members.slice(0, MAX_VISIBLE);
  const overflow = members.length - visible.length;
  const ring =
    "relative inline-flex shrink-0 rounded-full border-2 border-white transition hover:z-10 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4075cf] focus-visible:ring-offset-1";

  return (
    <>
      <span data-project-members className="hidden shrink-0 items-center -space-x-1 xl:flex">
        {visible.length > 0 && (
          <button
            type="button"
            data-project-members-manage
            aria-label="プロジェクトメンバーを管理"
            aria-haspopup="dialog"
            aria-expanded={open}
            title={visible[0].name}
            onClick={() => openDialog(false)}
            className={ring}
          >
            <UserAvatar name={visible[0].name} url={visible[0].avatar_url} className="h-7 w-7" />
          </button>
        )}
        {visible.slice(1).map((m) => (
          <button
            key={m.id}
            type="button"
            aria-label={`${m.name}（プロジェクトメンバー）`}
            aria-haspopup="dialog"
            aria-expanded={open}
            title={m.name}
            onClick={() => openDialog(false)}
            className={ring}
          >
            <UserAvatar name={m.name} url={m.avatar_url} className="h-7 w-7" />
          </button>
        ))}
        {overflow > 0 && (
          <button
            type="button"
            aria-label={`残り${overflow}人のメンバーを表示`}
            aria-haspopup="dialog"
            aria-expanded={open}
            title={`ほか${overflow}人`}
            onClick={() => openDialog(false)}
            className="relative inline-flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-neutral-100 px-1 text-[10px] font-semibold text-neutral-600 hover:z-10 hover:bg-neutral-200 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4075cf] focus-visible:ring-offset-1"
          >
            +{overflow}
          </button>
        )}
        <button
          type="button"
          data-project-member-add
          aria-label="メンバーを追加"
          aria-haspopup="dialog"
          aria-expanded={open}
          title="メンバーを追加"
          onClick={() => openDialog(true)}
          className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-neutral-300 bg-white text-neutral-500 transition hover:z-10 hover:border-[#4075cf] hover:text-[#4075cf] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4075cf] focus-visible:ring-offset-1"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </span>
      {open && (
        <ProjectShareDialog
          projectId={projectId}
          projectName={projectName}
          title={`${projectName}を共有`}
          focusAdd={focusAdd}
          onClose={close}
        />
      )}
    </>
  );
}
