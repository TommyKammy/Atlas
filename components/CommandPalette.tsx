"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Dialog from "./ui/Dialog";
import { isImeComposing } from "@/lib/ime-keyboard";
import {
  OPEN_COMMAND_PALETTE_EVENT,
  type OpenCommandPaletteDetail,
} from "@/lib/command-palette-events";
import { buildSearchOptions, type SearchSuggestData } from "@/lib/search-types";
import {
  buildPaletteSections,
  flattenPaletteSections,
  hasPaletteResults,
  movePaletteIndex,
  paletteOptionId,
  type PaletteItem,
} from "@/lib/command-palette";

const EMPTY: SearchSuggestData = { history: [], groups: {} };
const LISTBOX_ID = "command-palette-listbox";

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

export default function CommandPalette({
  showPortfolio,
  isAdmin,
}: {
  showPortfolio: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchSuggestData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusPending = useRef(false);

  const close = useCallback(() => {
    requestId.current += 1;
    restoreFocusPending.current = true;
    setOpen(false);
    setQuery("");
    setData(EMPTY);
    setLoading(false);
    setActiveIndex(-1);
  }, []);

  useEffect(() => {
    if (open || !restoreFocusPending.current) return;
    restoreFocusPending.current = false;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (
      target?.isConnected &&
      target !== document.body &&
      target !== document.documentElement &&
      !target.matches(":disabled")
    ) {
      target.focus({ preventScroll: true });
    }
  }, [open]);

  const openPalette = useCallback((trigger?: HTMLElement | null) => {
    restoreFocusPending.current = false;
    const active =
      trigger ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    returnFocusRef.current =
      active && active !== document.body && active !== document.documentElement
        ? active
        : null;
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.shiftKey || event.altKey) return;
      const modifier = isMacPlatform() ? event.metaKey : event.ctrlKey;
      if (!modifier || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (event.repeat) return;
      if (open) {
        close();
      } else {
        openPalette();
      }
    };
    // Capture so the shortcut works even inside controls that stop propagation.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [close, open, openPalette]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenCommandPaletteDetail>).detail;
      openPalette(detail?.trigger ?? null);
    };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
  }, [openPalette]);

  const trimmedQuery = query.trim();

  useEffect(() => {
    const id = requestId.current;
    if (!open || trimmedQuery === "") return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        if (id !== requestId.current) return;
        setLoading(true);
        fetch(`/api/search/suggest?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
        })
          .then((response) => (response.ok ? response.json() : EMPTY))
          .then((json: SearchSuggestData) => {
            if (id === requestId.current && !controller.signal.aborted) setData(json);
          })
          .catch(() => undefined)
          .finally(() => {
            if (id === requestId.current) setLoading(false);
          });
      },
      200,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, trimmedQuery]);

  const searchOptions = useMemo(
    () => (trimmedQuery === "" ? [] : buildSearchOptions(data, trimmedQuery)),
    [data, trimmedQuery],
  );

  const sections = useMemo(
    () =>
      buildPaletteSections({
        query: trimmedQuery,
        showPortfolio,
        isAdmin,
        searchOptions,
      }),
    [isAdmin, searchOptions, showPortfolio, trimmedQuery],
  );

  const items = useMemo(() => flattenPaletteSections(sections), [sections]);
  const indexedSections = sections.map((section, index) => ({
    ...section,
    start: sections
      .slice(0, index)
      .reduce((total, previous) => total + previous.items.length, 0),
  }));
  const showEmpty = !hasPaletteResults(sections);
  const selectedIndex =
    activeIndex >= 0 && activeIndex < items.length ? activeIndex : -1;

  useEffect(() => {
    if (selectedIndex < 0) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(paletteOptionId(selectedIndex))?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedIndex]);

  const execute = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      close();
      router.push(item.href);
    },
    [close, router],
  );

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Never let the Enter that confirms a conversion choose a command.
    if (isImeComposing(event)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(movePaletteIndex(selectedIndex, items.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(movePaletteIndex(selectedIndex, items.length, -1));
    } else if (event.key === "Home") {
      if (items.length === 0) return;
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      if (items.length === 0) return;
      event.preventDefault();
      setActiveIndex(items.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      execute(items[selectedIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="コマンドパレット"
      panelClassName="mb-[8vh] w-[min(640px,94vw)] overflow-hidden rounded-xl border border-line bg-surface text-text shadow-2xl"
      backdropClassName="backdrop:bg-scrim"
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
          className="pointer-events-none h-4 w-4 shrink-0 text-muted"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4 4" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="コマンドを検索"
          aria-expanded={open}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={selectedIndex >= 0 ? paletteOptionId(selectedIndex) : undefined}
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            requestId.current += 1;
            setQuery(value);
            setData(EMPTY);
            setLoading(false);
            setActiveIndex(-1);
          }}
          onKeyDown={onInputKeyDown}
          placeholder="コマンド、タスク、プロジェクトを検索"
          autoComplete="off"
          autoFocus
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm text-text outline-none placeholder:text-subtle"
        />
        <kbd className="hidden shrink-0 rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
          Esc
        </kbd>
      </div>

      {showEmpty && (
        <div role="status" className="px-3 py-3 text-center text-[13px] text-muted">
          該当する項目がありません
        </div>
      )}

      <div
        id={LISTBOX_ID}
        role="listbox"
        aria-label="コマンド候補"
        aria-busy={loading}
        className="max-h-[min(60vh,520px)] overflow-y-auto py-1"
      >
        {indexedSections.map((section) => {
          const headingId = `command-palette-group-${section.key}`;
          return (
            <div key={section.key} role="group" aria-labelledby={headingId}>
              <div
                id={headingId}
                className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted"
              >
                {section.label}
              </div>
              {section.items.map((item, offset) => {
                const index = section.start + offset;
                const selected = index === selectedIndex;
                return (
                  <div
                    key={item.key}
                    id={paletteOptionId(index)}
                    role="option"
                    aria-selected={selected}
                    data-command-palette-option={item.key}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => execute(item)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-[13px] text-text ${
                      selected ? "bg-accent-soft" : "hover:bg-surface-muted"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.sublabel && (
                      <span className="shrink-0 text-[11px] text-muted">{item.sublabel}</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-muted px-3 py-1.5 text-[11px] text-muted">
        <span>↑↓ 選択 · Enter 実行 · Esc 閉じる</span>
        {loading && (
          <span role="status" aria-live="polite">
            検索中…
          </span>
        )}
      </div>
    </Dialog>
  );
}
