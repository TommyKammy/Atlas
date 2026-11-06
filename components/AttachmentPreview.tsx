"use client";

import { useEffect, useState } from "react";

const IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXTY = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);

export default function AttachmentPreview({
  id,
  mime,
  name,
}: {
  id: number;
  mime: string;
  name: string;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!TEXTY.has(mime)) return;
    let live = true;
    fetch(`/api/attachments/${id}?inline=1`)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((t) => live && setText(t.slice(0, 800)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
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
  if (TEXTY.has(mime)) {
    return (
      <div className="max-w-full overflow-hidden rounded border bg-neutral-50 p-2">
        <div className="truncate text-xs font-semibold text-neutral-600">{name}</div>
        <pre className="mt-1 max-h-24 overflow-auto text-xs whitespace-pre-wrap text-neutral-700">
          {text ?? "読込中…"}
        </pre>
      </div>
    );
  }
  return <span title={name}>📄 {name}</span>;
}
