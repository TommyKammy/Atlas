"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import { useEffect, useRef, useState } from "react";
import type { User } from "@/lib/data";
import TaskAvatar from "../task/TaskAvatar";
import EmptyCellIcon from "./EmptyCellIcon";

/** Asana-style recommended-user picker for assignee fields. */
export default function AssigneePicker({
  users,
  currentId,
  onPick,
  onCancel,
}: {
  users: User[];
  currentId: number | null;
  onPick: (id: number | null) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const width = Math.max(220, Math.min(320, window.innerWidth - rect.left - 8));
    const openAbove = window.innerHeight - rect.bottom < 320;
    setPosition({
      left: rect.left,
      width,
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }, []);

  const normalized = query.trim().toLowerCase();
  const filtered = users.filter(
    (user) =>
      normalized === "" ||
      user.name.toLowerCase().includes(normalized) ||
      (user.email ?? "").toLowerCase().includes(normalized),
  );

  return (
    <div
      data-assignee-picker
      className="relative z-[140] min-w-0"
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            const first = filtered[0];
            if (first) onPick(first.id);
          }
        }}
        onBlur={(event) => {
          const related = event.relatedTarget as HTMLElement | null;
          if (related?.closest("[data-assignee-picker]")) return;
          if (related?.closest("[data-assignee-menu]")) return;
          onCancel();
        }}
        placeholder="名前またはメールアドレス"
        aria-label="担当者を検索"
        className="h-8 w-full min-w-0 rounded border border-accent bg-field px-2 text-[13px] outline-none"
      />
      {position && (
        <>
          <div className="fixed inset-0 z-[139]" onClick={onCancel} />
          <div
            data-assignee-menu
            onKeyDown={(event) => {
              if (isImeComposing(event)) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
              }
            }}
            className="fixed z-[140] overflow-hidden rounded-lg border border-line bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
            style={{
              left: position.left,
              width: position.width,
              ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }),
            }}
          >
            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted">
              おすすめのユーザー
            </div>
            <div role="listbox" aria-label="おすすめのユーザー" className="max-h-[260px] overflow-y-auto pb-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-subtle">該当するユーザーがいません</div>
              ) : (
                filtered.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    role="option"
                    aria-selected={user.id === currentId}
                    data-assignee-option={user.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onPick(user.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
                  >
                    <TaskAvatar
                      name={user.name}
                      url={user.avatar_url}
                      className="h-6 w-6"
                      textClassName="text-[10px]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate text-[13px] font-medium text-text">{user.name}</span>
                        {user.is_guest && (
                          <span className="shrink-0 rounded bg-surface-muted px-1 text-[10px] text-muted">ゲスト</span>
                        )}
                        {user.id === currentId && <span className="shrink-0 text-[11px] text-accent-text">✓</span>}
                      </span>
                      {user.email && (
                        <span className="block truncate text-[11px] text-muted">{user.email}</span>
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="border-t border-line p-1">
              <button
                type="button"
                data-assignee-unassign
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(null)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-secondary hover:bg-hover"
              >
                <EmptyCellIcon kind="assignee" />
                <span className="flex-1">未割り当て</span>
                {currentId === null && <span className="text-[11px] text-accent-text">✓</span>}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
