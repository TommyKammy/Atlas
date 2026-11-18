"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

const subscribeReady = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export const knowledgeActionBase = "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50";
export const knowledgeAction = `${knowledgeActionBase} border-neutral-200 text-neutral-700 hover:bg-neutral-50`;
export const knowledgePrimaryAction = `${knowledgeActionBase} border-accent bg-accent text-white hover:bg-[#24529c]`;
export const knowledgeMenuItem = "flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none disabled:opacity-50";

export function KnowledgeIcon({ name }: { name: "ai" | "download" | "edit" | "more" | "close" | "copy" | "history" | "trash" | "summary" | "chevron" }) {
  const paths = {
    ai: <><path d="m10 2 2.2 5.8L18 10l-5.8 2.2L10 18l-2.2-5.8L2 10l5.8-2.2Z" /><path d="M17 1v4M15 3h4" /></>,
    download: <path d="M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4" />,
    edit: <path d="m12 4 4 4M3 17l1-5L14 2l4 4L8 16Z" />,
    more: <><circle cx="4" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="16" cy="10" r="1" /></>,
    close: <path d="m5 5 10 10M15 5 5 15" />,
    copy: <><rect x="7" y="7" width="10" height="11" rx="1.5" /><path d="M13 7V2H3v11h4" /></>,
    history: <path d="M3 7a7 7 0 1 1 0 6M3 2v5h5M10 6v4l3 2" />,
    trash: <path d="M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v6M12 8v6" />,
    summary: <path d="M4 2h8l4 4v12H4ZM12 2v5h4M7 10h6M7 13h6" />,
    chevron: <path d="m6 8 4 4 4-4" />,
  };
  return <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

/** Native top-layer popover avoids clipping inside the project scroll container. */
export default function KnowledgeActionMenu({ label, children, className = knowledgeAction, onOpen, disabled = false, icon }: {
  label: string; icon: ReactNode; className?: string; disabled?: boolean; onOpen?: () => void;
  children: ReactNode;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      menu.current?.hidePopover();
    };
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", dismiss, true);
    return () => { window.removeEventListener("resize", dismiss); document.removeEventListener("scroll", dismiss, true); };
  }, [open]);
  const close = () => { menu.current?.hidePopover(); trigger.current?.focus(); };
  const show = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect || !menu.current) return;
    if (menu.current.matches(":popover-open")) { close(); return; }
    setPosition({ left: Math.max(12, Math.min(rect.right - 248, window.innerWidth - 260)), top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 220)) });
    menu.current.showPopover(); menu.current.focus(); onOpen?.();
  };
  return <>
    <button ref={trigger} type="button" className={className} aria-label={label} aria-haspopup="menu" aria-controls={id} aria-expanded={open} disabled={disabled || !ready} onClick={show}
      onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); if (!open) show(); menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); } }}>{icon}</button>
    <div ref={menu} id={id} popover="auto" role="menu" tabIndex={-1} aria-label={label} className="fixed m-0 w-[248px] max-w-[calc(100vw-24px)] rounded-lg border border-neutral-200 bg-surface p-1.5 text-neutral-900 shadow-sm outline-none" style={{ ...position, maxHeight: "60vh", overflowY: "auto" }}
      onClickCapture={event => { if ((event.target as HTMLElement).closest('button[role="menuitem"]:not(:disabled)')) close(); }}
      onToggle={event => setOpen(event.newState === "open")}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
        if (event.key === "Tab") close();
      }}>{children}</div>
  </>;
}
