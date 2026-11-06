"use client";

import { useState } from "react";
import InviteUserDialog from "./InviteUserDialog";

export default function SidebarInviteButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-sidebar-invite
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-white/15 bg-white/5 px-2 text-left text-[13px] text-neutral-200 hover:bg-white/10"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
          <path d="M18 8v6M15 11h6" />
        </svg>
        <span className="truncate">招待</span>
      </button>
      <InviteUserDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
