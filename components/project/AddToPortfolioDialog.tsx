"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { toast } from "@/lib/ui-feedback";
import Dialog from "../ui/Dialog";
import { PROJECT_DIALOG_PRIMARY, PROJECT_DIALOG_SECONDARY } from "./RenameProjectDialog";

export default function AddToPortfolioDialog({
  projectId,
  projectName,
  onClose,
  onChanged,
}: {
  projectId: number;
  projectName: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [inPortfolio, setInPortfolio] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api<{ id: number }[]>("/api/portfolio");
        if (!cancelled) setInPortfolio(Array.isArray(rows) && rows.some((row) => Number(row.id) === projectId));
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (inPortfolio) {
        await api("/api/portfolio", "DELETE", { project_id: projectId });
        setInPortfolio(false);
        toast("マイポートフォリオから削除しました");
      } else {
        await api("/api/portfolio", "POST", { project_id: projectId });
        setInPortfolio(true);
        toast("マイポートフォリオに追加しました");
      }
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="ポートフォリオに追加"
      backdropClassName="backdrop:bg-black/25"
      panelClassName="w-[min(480px,94vw)] rounded-xl bg-surface text-sm shadow-2xl"
    >
      <div data-project-portfolio-dialog className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">ポートフォリオに追加</h2>
            <p className="mt-0.5 text-xs text-muted">{projectName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl leading-none text-subtle hover:text-secondary">
            ×
          </button>
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-line p-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-accent-text">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
              <path d="M4 19V5M4 19h16M8 16V9M12 16V6M16 16v-4" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">マイポートフォリオ</div>
            <div className="text-xs text-muted">このプロジェクトを個人のポートフォリオ一覧に表示します。</div>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${inPortfolio ? "bg-success-soft text-success" : "bg-surface-muted text-muted"}`}>
            {loading ? "確認中" : inPortfolio ? "追加済み" : "未追加"}
          </span>
        </div>
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={PROJECT_DIALOG_SECONDARY} onClick={onClose}>
            閉じる
          </button>
          <button type="button" className={PROJECT_DIALOG_PRIMARY} onClick={() => void toggle()} disabled={loading || busy}>
            {busy ? "更新中…" : inPortfolio ? "ポートフォリオから削除" : "追加する"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
