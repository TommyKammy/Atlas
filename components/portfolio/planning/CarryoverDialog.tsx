"use client";

import { useState } from "react";
import { planningErrorMessage } from "./errors";
import PlanningDialog from "./PlanningDialog";
import {
  buttonPrimary,
  buttonSecondary,
  EmptyPanel,
  FieldError,
  Notice,
  Tag,
} from "./ui";
import type { PlanningCarryover } from "@/lib/planning/types";

export default function CarryoverDialog({
  open,
  onClose,
  carryovers,
  periodLabel,
  onAttach,
}: {
  open: boolean;
  onClose: () => void;
  carryovers: PlanningCarryover[];
  periodLabel: string;
  onAttach: (initiativeId: number) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const attach = async (initiative: PlanningCarryover) => {
    if (busyId !== null) return;
    setBusyId(initiative.id);
    setError("");
    try {
      await onAttach(initiative.id);
    } catch (caught) {
      setError(planningErrorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PlanningDialog
      open={open}
      onClose={onClose}
      title="既存の案件をこの四半期に追加"
      wide
      footer={
        <button type="button" className={buttonSecondary} onClick={onClose} disabled={busyId !== null}>
          閉じる
        </button>
      }
    >
      <div className="space-y-3">
        <Notice tone="info">
          同じ案件の四半期別見積もりとして追加します。前の四半期の費用・需要は複製せず、この四半期では未設定から始まります。元プロジェクトやタスクは変更しません。
        </Notice>
        <p className="text-[11px] text-muted">{periodLabel} にまだ追加されていない案件</p>
        {carryovers.length === 0 ? (
          <EmptyPanel title="追加できる案件はありません">
            既存の案件はすべてこの四半期に追加されています。
          </EmptyPanel>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
            {carryovers.map((initiative) => (
              <li key={initiative.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-neutral-900">{initiative.name}</span>
                    {initiative.kind === "fixed" ? <Tag>全案に固定</Tag> : <Tag tone="blue">比較候補</Tag>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-secondary">{initiative.expectedEffect}</p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    {initiative.linkedProjectName
                      ? `元プロジェクト: ${initiative.linkedProjectName}`
                      : "新規提案（元プロジェクトなし）"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void attach(initiative)}
                  className={buttonPrimary}
                  disabled={busyId !== null}
                >
                  {busyId === initiative.id ? "追加中…" : "この四半期に追加"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <FieldError>{error}</FieldError>}
      </div>
    </PlanningDialog>
  );
}
