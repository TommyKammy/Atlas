"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  buttonPrimary,
  buttonSecondary,
  FieldError,
  inputClass,
  labelClass,
  Notice,
} from "./ui";
import PlanningDialog from "./PlanningDialog";
import PlanningTable from "./PlanningTable";
import OwnerPicker, { type OwnerSelection } from "./OwnerPicker";
import { planningErrorMessage } from "./errors";
import {
  formatDays,
  monthLabelFromStart,
  periodLabel,
  yenToManYenInput,
  parseDaysInput,
  parseManYenInput,
} from "@/lib/planning/format";
import type {
  PlanningCarryover,
  PlanningInitiative,
  PlanningInitiativeKind,
  PlanningMonth,
  PlanningOwnerCandidate,
  PlanningPeriodSummary,
  PlanningProjectOption,
  PlanningRole,
} from "@/lib/planning/types";
import { PLANNING_MONTHS } from "@/lib/planning/types";

export type InitiativeSaveInput = {
  name: string;
  ownerMemberId: number | null;
  /** Present only when retaining the exact legacy free-text owner. */
  ownerName?: string;
  expectedEffect: string;
  kind: PlanningInitiativeKind;
  linkedProjectId: number | null;
  costYen: number | null;
  demands: { roleId: number; monthIndex: PlanningMonth; days: number }[];
};

function demandKey(roleId: number, monthIndex: PlanningMonth) {
  return `${roleId}:${monthIndex}`;
}

export default function InitiativeDialog({
  open,
  onClose,
  period,
  roles,
  projects,
  initiatives,
  carryovers,
  ownerCandidates,
  currentUserId,
  initiative,
  focusLink = false,
  onSave,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  period: PlanningPeriodSummary;
  roles: PlanningRole[];
  projects: PlanningProjectOption[];
  initiatives: PlanningInitiative[];
  carryovers: PlanningCarryover[];
  ownerCandidates: PlanningOwnerCandidate[];
  currentUserId: number;
  initiative?: PlanningInitiative;
  focusLink?: boolean;
  onSave: (input: InitiativeSaveInput) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const formId = useId();
  const [name, setName] = useState("");
  const [ownerSelection, setOwnerSelection] = useState<OwnerSelection>({ type: "none" });
  const [expectedEffect, setExpectedEffect] = useState("");
  const [kind, setKind] = useState<PlanningInitiativeKind>("candidate");
  const [linkedProjectId, setLinkedProjectId] = useState("");
  const [cost, setCost] = useState("");
  const [demandValues, setDemandValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setName(initiative?.name ?? "");
    setOwnerSelection(
      initiative
        ? initiative.ownerMemberId !== null
          ? { type: "member", id: initiative.ownerMemberId, name: initiative.ownerName }
          : { type: "legacy", name: initiative.ownerName }
        : { type: "none" },
    );
    setExpectedEffect(initiative?.expectedEffect ?? "");
    setKind(initiative?.kind ?? "candidate");
    setLinkedProjectId(initiative?.linkedProjectId ? String(initiative.linkedProjectId) : "");
    setCost(initiative?.costYen === null || initiative?.costYen === undefined ? "" : yenToManYenInput(initiative.costYen));
    const next: Record<string, string> = {};
    for (const role of roles) {
      for (const monthIndex of PLANNING_MONTHS) {
        const demand = initiative?.demands.find(
          (entry) => entry.roleId === role.id && entry.monthIndex === monthIndex,
        );
        next[demandKey(role.id, monthIndex)] =
          demand === undefined ? "" : formatDays(demand.days);
      }
    }
    setDemandValues(next);
    setBusy(false);
    setError("");
  }, [open, initiative, roles]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (name.trim() === "") {
      setError("案件名を入力してください");
      return;
    }
    if (ownerSelection.type === "none") {
      setError("起案責任者を選択してください");
      return;
    }
    if (expectedEffect.trim() === "") {
      setError("期待効果を入力してください");
      return;
    }
    const parsedCost = parseManYenInput(cost);
    if (!parsedCost.ok) {
      setError(parsedCost.error);
      return;
    }
    const demands: InitiativeSaveInput["demands"] = [];
    for (const role of roles) {
      for (const monthIndex of PLANNING_MONTHS) {
        const raw = demandValues[demandKey(role.id, monthIndex)] ?? "";
        const parsed = parseDaysInput(raw);
        if (!parsed.ok) {
          setError(`${role.name} ${monthLabelFromStart(period.startMonth, monthIndex)}: ${parsed.error}`);
          return;
        }
        if (parsed.value !== null) {
          demands.push({ roleId: role.id, monthIndex, days: parsed.value });
        }
      }
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        name: name.trim(),
        ownerMemberId: ownerSelection.type === "member" ? ownerSelection.id : null,
        ...(ownerSelection.type === "legacy" ? { ownerName: ownerSelection.name } : {}),
        expectedEffect: expectedEffect.trim(),
        kind,
        linkedProjectId: linkedProjectId === "" ? null : Number(linkedProjectId),
        costYen: parsedCost.value,
        demands,
      });
    } catch (caught) {
      setError(planningErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!onRemove || busy) return;
    setBusy(true);
    setError("");
    try {
      await onRemove();
    } catch (caught) {
      setError(planningErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const linkedIds = new Set([
    ...initiatives
      .filter((entry) => entry.id !== initiative?.id && entry.linkedProjectId !== null)
      .map((entry) => entry.linkedProjectId),
    ...carryovers.map((entry) => entry.linkedProjectId),
  ]);
  const projectOptions = projects.filter((project) => !linkedIds.has(project.id));

  return (
    <PlanningDialog
      open={open}
      onClose={onClose}
      title={initiative ? "案件を編集" : "案件を登録"}
      wide
      footer={
        <>
          {onRemove && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="mr-auto min-h-9 rounded-md px-2 text-[12px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              この四半期から外す
            </button>
          )}
          <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="submit" form={formId} className={buttonPrimary} disabled={busy}>
            {busy ? "保存中…" : initiative ? "変更を保存" : "案件を登録"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-[11px] text-muted">{periodLabel(period.year, period.quarter)} の案件と見積もり</p>
        <label className={labelClass}>
          案件名
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={`${inputClass} mt-1`}
            maxLength={160}
            autoFocus={!focusLink}
            required
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <OwnerPicker
            candidates={ownerCandidates}
            currentUserId={currentUserId}
            value={ownerSelection}
            onChange={setOwnerSelection}
          />
          <label className={labelClass}>
            期間内の概算費用（万円）
            <input
              type="number"
              min={0}
              step="0.01"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              className={`${inputClass} mt-1`}
              placeholder="未設定可"
            />
          </label>
        </div>
        <label className={labelClass}>
          期待効果
          <textarea
            value={expectedEffect}
            onChange={(event) => setExpectedEffect(event.target.value)}
            className={`${inputClass} mt-1 min-h-20 py-2`}
            maxLength={1000}
            required
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            案件の扱い
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as PlanningInitiativeKind)}
              className={`${inputClass} mt-1`}
            >
              <option value="candidate">比較候補</option>
              <option value="fixed">全案に固定</option>
            </select>
          </label>
          <label className={labelClass}>
            元プロジェクト（任意）
            <select
              value={linkedProjectId}
              onChange={(event) => setLinkedProjectId(event.target.value)}
              className={`${inputClass} mt-1`}
              autoFocus={focusLink}
            >
              <option value="">紐付けない（新規提案）</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
              {initiative?.linkedProjectId &&
                !projectOptions.some((project) => project.id === initiative.linkedProjectId) && (
                  <option value={initiative.linkedProjectId}>
                    {initiative.linkedProjectName ?? `プロジェクト #${initiative.linkedProjectId}`}
                    （ポートフォリオ外）
                  </option>
                )}
            </select>
          </label>
        </div>
        <p className="text-[11px] text-muted">
          紐付けできるのは、この共有ポートフォリオに所属し、あなたが閲覧できるプロジェクトだけです。プロジェクトやタスク、開始日、担当者は複製しません。
        </p>

        <section>
          <h3 className="text-[13px] font-semibold text-neutral-900">職種別・月別の需要</h3>
          <p className="mt-1 text-[11px] text-muted">
            人日は0.1刻み。空欄は未見積もりで、0は需要なしとして明示的に保存します。費用の空欄も未設定として扱います。
          </p>
          {roles.length === 0 ? (
            <Notice tone="warn">
              職種がまだ登録されていません。「職種別の余力」から職種を登録すると、需要を入力できます。
            </Notice>
          ) : (
            <PlanningTable
              label="職種別・月別の需要入力"
              caption="職種別・月別の需要入力"
              className="mt-2 rounded-lg border border-neutral-200"
            >
              <thead className="bg-surface-subtle">
                <tr>
                  <th scope="col" className="border-b border-neutral-200 px-3 py-2 text-left text-[11px] font-semibold text-secondary">
                    職種 / 人日
                  </th>
                  {PLANNING_MONTHS.map((monthIndex) => (
                    <th
                      key={monthIndex}
                      scope="col"
                      className="border-b border-neutral-200 px-2 py-2 text-left text-[11px] font-semibold text-secondary"
                    >
                      {monthLabelFromStart(period.startMonth, monthIndex)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-b border-neutral-100 last:border-b-0">
                    <th scope="row" className="bg-surface px-3 py-2 text-left text-[12px] font-medium text-neutral-800">
                      {role.name}
                    </th>
                    {PLANNING_MONTHS.map((monthIndex) => (
                      <td key={monthIndex} className="px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          max={9999}
                          step="0.1"
                          value={demandValues[demandKey(role.id, monthIndex)] ?? ""}
                          onChange={(event) =>
                            setDemandValues((current) => ({
                              ...current,
                              [demandKey(role.id, monthIndex)]: event.target.value,
                            }))
                          }
                          aria-label={`${role.name} ${monthLabelFromStart(period.startMonth, monthIndex)}の需要（人日）`}
                          className={`${inputClass} h-8 w-24`}
                          placeholder="未設定"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </PlanningTable>
          )}
        </section>
        {error && <FieldError>{error}</FieldError>}
      </form>
    </PlanningDialog>
  );
}
