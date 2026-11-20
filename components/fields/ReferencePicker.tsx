"use client";

import { useEffect, useMemo, useState } from "react";
import type { CustomField } from "@/lib/custom-fields";

type ReferenceOption = {
  id: number;
  name: string;
  project_name: string;
  completed: boolean;
};

/** Searchable task picker for a reference field. */
export default function ReferencePicker({
  field,
  initial,
  onSave,
  onCancel,
}: {
  field: CustomField;
  initial: number[];
  onSave: (ids: number[]) => void;
  onCancel: () => void;
}) {
  const sourceKey = (field.config?.source_project_ids ?? []).join(",");
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [selected, setSelected] = useState<number[]>(initial);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reference-options?project_ids=${sourceKey}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: ReferenceOption[]) => {
        if (!cancelled) setOptions(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.name.toLowerCase().includes(needle) ||
        option.project_name.toLowerCase().includes(needle),
    );
  }, [options, query]);

  return (
    <div
      className="absolute top-full left-0 z-[160] mt-1 w-72 rounded-lg border border-line bg-surface p-2 shadow-xl"
      onClick={(event) => event.stopPropagation()}
      data-reference-picker
    >
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="タスクを検索"
        className="h-8 w-full rounded border border-field-line px-2 text-[12px] outline-none focus:border-accent"
      />
      <div className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto">
        {loading && <div className="px-1 py-3 text-[11px] text-subtle">読み込み中…</div>}
        {!loading && filtered.length === 0 && (
          <div className="px-1 py-3 text-[11px] text-subtle">該当するタスクがありません</div>
        )}
        {filtered.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-hover"
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={selected.includes(option.id)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, option.id]
                    : current.filter((id) => id !== option.id),
                )
              }
            />
            <span className="min-w-0">
              <span className="block truncate text-secondary">{option.name}</span>
              <span className="block truncate text-[10px] text-subtle">{option.project_name}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line-subtle pt-2">
        <span className="text-[10px] text-subtle">{selected.length}件を選択</span>
        <span className="flex gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-1 text-[11px] text-muted hover:bg-hover"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onSave(selected)}
            className="rounded bg-accent px-3 py-1 text-[11px] font-medium text-on-accent hover:bg-accent-hover"
          >
            保存
          </button>
        </span>
      </div>
    </div>
  );
}
