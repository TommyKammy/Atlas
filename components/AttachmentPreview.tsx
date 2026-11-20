"use client";

import { useEffect, useState } from "react";

const IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
import { TEXT_PREVIEW_TYPES, TEXT_PREVIEW_CHARACTERS } from "@/lib/attachment-preview";

export default function AttachmentPreview({
  id,
  mime,
  name,
}: {
  id: number;
  mime: string;
  name: string;
}) {
  const [preview, setPreview] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    if (!TEXT_PREVIEW_TYPES.has(mime)) return;
    const controller = new AbortController();
    fetch(`/api/attachments/${id}?inline=1&preview=1`, { signal: controller.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((text) => {
        if (!controller.signal.aborted) setPreview({ id, text: text.slice(0, TEXT_PREVIEW_CHARACTERS) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreview({ id, text: "プレビューを読み込めませんでした" });
      });
    return () => controller.abort();
  }, [id, mime]);

  if (IMAGE.has(mime)) {
    return (
      <a href={`/api/attachments/${id}`} title={name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/attachments/${id}?inline=1`}
          alt={name}
          className="max-h-24 rounded border object-contain"
          loading="lazy"
        />
      </a>
    );
  }
  if (TEXT_PREVIEW_TYPES.has(mime)) {
    return (
      <div className="max-w-full overflow-hidden rounded border bg-surface-subtle p-2">
        <div className="truncate text-xs font-semibold text-secondary">{name}</div>
        <pre className="mt-1 max-h-24 overflow-auto text-xs whitespace-pre-wrap text-secondary">
          {preview?.id === id ? preview.text : "読込中…"}
        </pre>
      </div>
    );
  }
  return <span title={name}>📄 {name}</span>;
}
