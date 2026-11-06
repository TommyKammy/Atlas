"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ProjectTitle({
  projectId,
  name,
  canEdit,
}: {
  projectId: number;
  name: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    const next = value.trim();
    setEditing(false);
    if (next === "" || next === name) {
      setValue(name);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        alert(`プロジェクト名の変更に失敗しました: ${res.status}`);
        setValue(name);
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <input
        data-project-title-input
        aria-label="プロジェクト名"
        value={value}
        autoFocus
        maxLength={100}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setValue(name);
            setEditing(false);
          }
        }}
        className="min-w-0 w-[min(60vw,520px)] rounded-md border border-blue-500 bg-white px-1 text-[18px] leading-7 font-medium outline-none sm:text-[20px]"
      />
    );
  }

  return (
    <h1
      data-project-title={name}
      className={`min-w-0 truncate text-[18px] leading-7 font-medium sm:text-[20px] ${
        canEdit ? "cursor-text rounded px-1 -mx-1 hover:bg-neutral-100" : ""
      }`}
      title={canEdit ? "クリックでプロジェクト名を変更" : undefined}
      onClick={() => {
        if (!canEdit) return;
        setValue(name);
        setEditing(true);
      }}
    >
      {name}
    </h1>
  );
}
