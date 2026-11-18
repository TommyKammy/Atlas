"use client";

import { useRef, useState } from "react";
import Dialog from "../ui/Dialog";
import { PROJECT_DIALOG_SECONDARY } from "./RenameProjectDialog";

export default function ProjectImportDialog({
  projectId,
  projectName,
  initialMode = "csv",
  onClose,
  onImported,
}: {
  projectId: number;
  projectName: string;
  initialMode?: "file" | "csv";
  onClose: () => void;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const submit = async (chosen: File) => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", chosen);
      const res = await fetch(`/api/projects/${projectId}/import`, { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as
        | { created?: number; skipped?: number; error?: string }
        | null;
      if (!res.ok) {
        setError(data?.error ?? `インポートに失敗しました（${res.status}）`);
      } else {
        setResult({ created: Number(data?.created ?? 0), skipped: Number(data?.skipped ?? 0) });
        onImported();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const choose = (next: File | null) => {
    setFile(next);
    setResult(null);
    setError("");
    if (next) void submit(next);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="インポート"
      backdropClassName="backdrop:bg-black/25"
      panelClassName="w-[min(560px,94vw)] rounded-xl bg-surface text-sm shadow-2xl"
    >
      <div data-project-import-dialog data-import-mode={initialMode} className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">インポート</h2>
            <p className="mt-0.5 text-xs text-muted">{projectName} ・ CSV（最大5MB / 1,000行）</p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl leading-none text-subtle hover:text-secondary">
            ×
          </button>
        </div>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0] ?? null;
            if (dropped) choose(dropped);
          }}
          className={`mt-4 rounded-lg border-2 border-dashed p-8 text-center transition ${
            dragging ? "border-[#4075cf] bg-accent-soft" : "border-line-strong bg-surface-subtle/50"
          }`}
        >
          <div className="text-sm font-medium text-secondary">
            {busy ? "インポート中…" : "CSVファイルをドロップ"}
          </div>
          <p className="mt-1 text-xs text-muted">または</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mt-2 h-8 rounded-md border border-line-strong bg-surface px-3 text-sm text-secondary hover:bg-hover disabled:opacity-50"
          >
            ファイルを選択
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (chosen) choose(chosen);
            }}
          />
          {file && <p className="mt-2 text-xs text-muted">{file.name}</p>}
        </div>
        {result && (
          <div className="mt-4 rounded-md border border-success-line bg-success-soft px-3 py-2 text-sm text-success" data-import-result>
            {result.created}件を作成し、{result.skipped}件をスキップしました。
          </div>
        )}
        {error && <p className="mt-4 text-xs text-danger">{error}</p>}
        <div className="mt-4 rounded-md border border-line bg-surface-subtle px-3 py-2 text-xs text-muted">
          1行目は「セクション, 種別, 名前, 完了, 担当者, 開始日, 期日, 進捗, Status, 繰返し, コメント」の順で指定してください。
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" className={PROJECT_DIALOG_SECONDARY} onClick={onClose}>
            {result ? "閉じる" : "キャンセル"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
