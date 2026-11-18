"use client";

import Link from "next/link";
import type { PlanningPeriodSummary, PlanningView } from "@/lib/planning/types";
import { buttonPrimary, buttonSecondary, Tag } from "./ui";

const VIEWS: { value: PlanningView; label: string }[] = [
  { value: "ledger", label: "案件台帳" },
  { value: "capacity", label: "職種別の余力" },
  { value: "compare", label: "投資シナリオ比較" },
];

export default function PlanningHeader({
  portfolioName,
  backHref,
  periods,
  selectedPeriod,
  view,
  canEdit,
  canManageViewers,
  approvalEnabled,
  restricted,
  onView,
  onPeriod,
  onNewPeriod,
  onManageViewers,
  onApprovalSettings,
}: {
  portfolioName: string;
  backHref: string;
  periods: PlanningPeriodSummary[];
  selectedPeriod: PlanningPeriodSummary | null;
  view: PlanningView;
  canEdit: boolean;
  canManageViewers: boolean;
  approvalEnabled: boolean;
  restricted: boolean;
  onView: (view: PlanningView) => void;
  onPeriod: (period: PlanningPeriodSummary) => void;
  onNewPeriod: () => void;
  onManageViewers: () => void;
  onApprovalSettings: () => void;
}) {
  return (
    <header className="space-y-3">
      <nav aria-label="パンくず" className="text-[12px] text-muted">
        <Link href={backHref} className="text-accent-text hover:underline">
          ポートフォリオ
        </Link>
        <span className="mx-1.5" aria-hidden>›</span>
        <span>共有ポートフォリオ</span>
        <span className="mx-1.5" aria-hidden>›</span>
        <span>投資計画</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text sm:flex"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
              <path d="M3 7h18v13H3z" />
              <path d="M8 7V4h8v3M3 12h18" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] leading-tight font-semibold text-text">{portfolioName}</h1>
              <Tag tone={restricted ? "warn" : canEdit ? "blue" : "neutral"}>
                {restricted ? "閲覧制限" : canEdit ? "編集可能" : "閲覧のみ"}
              </Tag>
              {approvalEnabled && <Tag tone="blue">承認フロー有効</Tag>}
            </div>
            <p className="mt-0.5 text-[12px] text-muted">共有ポートフォリオの投資計画</p>
            <Link href={backHref} className="mt-1 inline-block text-[11px] text-accent-text hover:underline">
              ← 選択中のポートフォリオに戻る
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {periods.length > 0 && (
            <label className="flex items-center gap-2 text-[11px] font-medium text-secondary">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 text-muted" aria-hidden>
                  <path d="M3 6h18v15H3zM7 3v6M17 3v6M3 11h18" />
                </svg>
                <span className="sr-only">対象四半期</span>
                <select
                  value={selectedPeriod?.id ?? ""}
                  onChange={(event) => {
                    const period = periods.find((entry) => entry.id === Number(event.target.value));
                    if (period) onPeriod(period);
                  }}
                  className="bg-transparent text-[12px] font-semibold text-text outline-none"
                  aria-label="対象四半期"
                >
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}
          {canManageViewers && (
            <button type="button" className={buttonSecondary} onClick={onManageViewers}>
              閲覧者
            </button>
          )}
          {canEdit && (
            <button type="button" className={buttonSecondary} onClick={onApprovalSettings}>
              承認設定
            </button>
          )}
          {canEdit && (
            <button type="button" className={buttonPrimary} onClick={onNewPeriod}>
              新しい四半期
            </button>
          )}
        </div>
      </div>

      <nav aria-label="投資計画" className="flex gap-4 overflow-x-auto border-b border-line text-[13px] whitespace-nowrap">
        {VIEWS.map((item) => {
          const current = view === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onView(item.value)}
              aria-current={current ? "page" : undefined}
              className={`-mb-px border-b-2 px-0.5 py-2 font-medium ${
                current
                  ? "border-accent text-accent-text"
                  : "border-transparent text-secondary hover:border-line-strong hover:text-text"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
