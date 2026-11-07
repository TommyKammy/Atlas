"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SearchSuggestMenu from "./search/SearchSuggestMenu";
import {
  buildSearchOptions,
  searchOptionId,
  type SearchSuggestData,
} from "@/lib/search-types";

const EMPTY: SearchSuggestData = { history: [], groups: {} };

export default function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SearchSuggestData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const root = useRef<HTMLDivElement>(null);

  const options = buildSearchOptions(data, q);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal })
          .then((res) => (res.ok ? res.json() : EMPTY))
          .then((json: SearchSuggestData) => setData(json))
          .catch(() => undefined)
          .finally(() => setLoading(false));
      },
      q === "" ? 0 : 200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, open]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setActiveIndex(-1));
    return () => window.cancelAnimationFrame(frame);
  }, [q, data]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(searchOptionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeIndex]);

  const submit = () => {
    const query = q.trim();
    if (!query) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  const clearHistory = async () => {
    await fetch("/api/search/history", { method: "DELETE" }).catch(() => undefined);
    setData((prev) => ({ ...prev, history: [] }));
  };

  const moveActive = (delta: 1 | -1) => {
    if (!open) {
      setOpen(true);
      return;
    }
    if (options.length === 0) return;
    setActiveIndex((current) => {
      if (current < 0) return delta === 1 ? 0 : options.length - 1;
      return (current + delta + options.length) % options.length;
    });
  };

  const showMenu = open;

  return (
    <div
      ref={root}
      data-global-search
      className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 px-4 md:block"
    >
      <div className="pointer-events-auto relative mx-auto w-full max-w-[640px]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 text-neutral-400"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4 4" />
        </svg>
        <input
          data-global-search-input
          role="combobox"
          aria-expanded={showMenu}
          aria-controls="global-search-menu"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? searchOptionId(activeIndex) : undefined}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              moveActive(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              moveActive(-1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open && activeIndex >= 0 && options[activeIndex]) {
                const option = options[activeIndex];
                setOpen(false);
                router.push(option.href);
              } else {
                submit();
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="タスク、プロジェクト、メッセージを検索"
          aria-label="グローバル検索"
          className="w-full rounded-full bg-[#333333] py-1.5 pr-4 pl-9 text-sm text-white placeholder:text-neutral-400 outline-none hover:bg-[#3a3a3a] focus:bg-[#3a3a3a]"
        />
        <SearchSuggestMenu
          open={showMenu}
          q={q}
          options={options}
          loading={loading}
          activeIndex={activeIndex}
          onClearHistory={() => void clearHistory()}
          onSelect={() => setOpen(false)}
        />
      </div>
    </div>
  );
}
