"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ImportForm({ projectId }: { projectId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const submit = async (file: File) => {
    setBusy(true);
    setResult("");
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/projects/${projectId}/import`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setResult(`失敗: ${data?.error ?? res.status}`);
      } else {
        setResult(`取込完了: ${data.created}件作成・${data.skipped}件スキップ`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-muted">インポート:</span>
      <label className="cursor-pointer rounded border px-2 py-0.5 hover:bg-neutral-50">
        {busy ? "取込中…" : "CSVを選択"}
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) submit(f);
            e.target.value = "";
          }}
        />
      </label>
      {result && <span className="text-secondary">{result}</span>}
    </span>
  );
}
