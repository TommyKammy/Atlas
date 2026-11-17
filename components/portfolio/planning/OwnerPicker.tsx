"use client";

import { useEffect, useId, useRef, useState } from "react";
import { isImeComposing } from "@/lib/ime-keyboard";
import type { PlanningOwnerCandidate } from "@/lib/planning/types";

export type OwnerSelection =
  | { type: "none" }
  | { type: "member"; id: number; name: string }
  | { type: "legacy"; name: string };

const searchLabel = "メンバーを検索（名前またはメールアドレス）";

export default function OwnerPicker({
  candidates,
  currentUserId,
  value,
  onChange,
}: {
  candidates: PlanningOwnerCandidate[];
  currentUserId: number;
  value: OwnerSelection;
  onChange: (value: OwnerSelection) => void;
}) {
  const inputId = useId();
  const listboxId = useId();
  const listboxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const normalized = query.trim().toLocaleLowerCase("ja-JP");
  const filtered = candidates.filter(
    (candidate) =>
      normalized === "" ||
      candidate.name.toLocaleLowerCase("ja-JP").includes(normalized) ||
      (candidate.email ?? "").toLocaleLowerCase("ja-JP").includes(normalized),
  );
  const selectedCandidate =
    value.type === "member" ? candidates.find((candidate) => candidate.id === value.id) : undefined;
  const selectedIsInactive = value.type === "member" && selectedCandidate === undefined;
  const hasSelection = value.type !== "none";
  const selfCandidate = candidates.find((candidate) => candidate.id === currentUserId);
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
  const activeCandidate = open ? filtered[safeActiveIndex] : undefined;
  const activeOptionId = activeCandidate
    ? `${listboxId}-option-${activeCandidate.id}`
    : null;

  useEffect(() => {
    if (!open || activeOptionId === null) return;
    const listbox = listboxRef.current;
    const option = document.getElementById(activeOptionId);
    if (!listbox || !option || !listbox.contains(option)) return;
    const listboxRect = listbox.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    if (optionRect.top < listboxRect.top) {
      listbox.scrollTop -= listboxRect.top - optionRect.top;
    } else if (optionRect.bottom > listboxRect.bottom) {
      listbox.scrollTop += optionRect.bottom - listboxRect.bottom;
    }
  }, [activeOptionId, open]);

  const choose = (candidate: PlanningOwnerCandidate) => {
    onChange({
      type: "member",
      id: candidate.id,
      // Keep the stored historical name when the same member is re-selected.
      name: value.type === "member" && value.id === candidate.id ? value.name : candidate.name,
    });
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  };

  const chooseSelf = () => {
    if (selfCandidate) choose(selfCandidate);
  };

  return (
    <fieldset className="min-w-0" data-owner-picker>
      <legend className="block text-[12px] font-medium text-neutral-600">起案責任者</legend>

      <div aria-live="polite">
        {value.type === "member" ? (
          <div
            data-owner-selected
            className={`mt-1 rounded-md border px-3 py-2 ${
              selectedIsInactive
                ? "border-amber-300 bg-amber-50/70"
                : "border-emerald-300 bg-emerald-50/70"
            }`}
          >
            <p
              data-owner-selected-name
              className="min-w-0 text-[13px] font-semibold break-words text-neutral-900"
            >
              {value.name}
            </p>
            {selectedCandidate?.email ? (
              <p className="mt-0.5 text-[11px] break-all text-neutral-600">{selectedCandidate.email}</p>
            ) : selectedIsInactive ? (
              <p className="mt-0.5 text-[11px] text-amber-800">無効なアカウント・このまま保持</p>
            ) : (
              <p className="mt-0.5 text-[11px] text-neutral-500">メールアドレス未登録</p>
            )}
          </div>
        ) : value.type === "legacy" ? (
          <div
            data-owner-legacy
            className="mt-1 rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2"
          >
            <p
              data-owner-legacy-name
              className="min-w-0 text-[13px] font-semibold break-words text-neutral-900"
            >
              {value.name}
            </p>
            <p className="mt-0.5 text-[11px] text-amber-900">旧入力・このまま保持</p>
          </div>
        ) : null}
      </div>

      <div className={`flex flex-wrap items-end gap-2 ${hasSelection ? "mt-2" : ""}`}>
        <div className="min-w-[220px] flex-1">
          <label
            htmlFor={inputId}
            className={hasSelection ? "block text-[11px] font-medium text-neutral-600" : "sr-only"}
          >
            {searchLabel}
          </label>
          <div className="relative mt-1">
            <input
              id={inputId}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              aria-activedescendant={
                activeCandidate ? `${listboxId}-option-${activeCandidate.id}` : undefined
              }
              autoComplete="off"
              placeholder={hasSelection ? undefined : "名前またはメールで検索"}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={(event) => {
                if (isImeComposing(event)) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOpen(true);
                  setActiveIndex((current) =>
                    filtered.length === 0 ? 0 : Math.min(current + 1, filtered.length - 1),
                  );
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setOpen(true);
                  setActiveIndex((current) => Math.max(current - 1, 0));
                  return;
                }
                if (event.key === "Home" && open) {
                  event.preventDefault();
                  setActiveIndex(0);
                  return;
                }
                if (event.key === "End" && open) {
                  event.preventDefault();
                  setActiveIndex(Math.max(0, filtered.length - 1));
                  return;
                }
                if (event.key === "Enter") {
                  // The picker is inside a form. Never let Enter in the search
                  // field submit the form, even when the list is closed.
                  event.preventDefault();
                  if (open && activeCandidate) choose(activeCandidate);
                  return;
                }
                if (event.key === "Escape" && open) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
              className="h-9 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-[13px] text-neutral-900 outline-none focus:border-[#2c60b8]"
            />
            {open && (
              <div className="absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-md border border-neutral-300 bg-white shadow-lg">
                <div
                  id={listboxId}
                  ref={listboxRef}
                  role="listbox"
                  aria-label="起案責任者の候補"
                  className="max-h-56 overflow-y-auto py-1"
                >
                  {filtered.length === 0 ? (
                    <p className="px-3 py-2 text-[12px] text-neutral-500">
                      該当するメンバーがいません。
                    </p>
                  ) : (
                    filtered.map((candidate, index) => {
                      const isSelected = value.type === "member" && value.id === candidate.id;
                      const isActive = index === safeActiveIndex;
                      const email = candidate.email?.trim();
                      return (
                        <button
                          key={candidate.id}
                          id={`${listboxId}-option-${candidate.id}`}
                          type="button"
                          role="option"
                          tabIndex={-1}
                          aria-selected={isSelected}
                          data-owner-option={candidate.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose(candidate)}
                          className={`flex w-full items-start gap-2 px-3 py-2 text-left ${
                            isSelected ? "bg-blue-50 hover:bg-blue-100" : "bg-white hover:bg-neutral-100"
                          } ${isActive ? "ring-2 ring-[#2c60b8] ring-inset" : ""}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 flex-wrap items-center gap-1">
                              <span className="truncate text-[13px] font-medium text-neutral-900">
                                {candidate.name}
                              </span>
                              {isSelected && (
                                <span aria-hidden="true" className="text-[11px] font-semibold text-[#24529c]">
                                  ✓
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-neutral-500">
                              {email || "メールアドレス未登録"}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          data-owner-self
          onClick={chooseSelf}
          disabled={!selfCandidate}
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          自分を設定
        </button>
      </div>
    </fieldset>
  );
}
