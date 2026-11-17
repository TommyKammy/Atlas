"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { confirmAction, toast } from "@/lib/ui-feedback";
import { periodKey as makePeriodKey } from "@/lib/planning/format";
import type { PlanningScenarioResult } from "@/lib/planning/calculations";
import { scenarioCalculation } from "@/lib/planning/select";
import type {
  PlanningMonth,
  PlanningPeriodSummary,
  PlanningRole,
  PlanningState,
  PlanningView,
} from "@/lib/planning/types";
import AdoptDialog from "./AdoptDialog";
import ApprovalSettingsDialog, { type ApprovalSettingsInput } from "./ApprovalSettingsDialog";
import BreakdownDialog from "./BreakdownDialog";
import BudgetDialog from "./BudgetDialog";
import CapacityDialog from "./CapacityDialog";
import CapacityView from "./CapacityView";
import CarryoverDialog from "./CarryoverDialog";
import CompareView from "./CompareView";
import InitiativeDialog, { type InitiativeSaveInput } from "./InitiativeDialog";
import LedgerView from "./LedgerView";
import PeriodDialog from "./PeriodDialog";
import PlanningHeader from "./PlanningHeader";
import RolesDialog from "./RolesDialog";
import ViewersDialog from "./ViewersDialog";
import type { ProposalSubmitInput } from "./SubmitProposalDialog";
import type { ProposalDecisionInput } from "./ProposalDecisionForm";
import type { ProposalReviewInput } from "./ProposalReviewForm";
import type { ProposalWithdrawInput } from "./ProposalWithdrawForm";
import { isStaleRevisionError, planningErrorMessage } from "./errors";
import { buttonPrimary, EmptyPanel, Notice, buttonSecondary } from "./ui";

type InitiativeDialogState = {
  initiativeId: number | null;
  focusLink: boolean;
};

type BreakdownState = {
  result: PlanningScenarioResult;
  role: PlanningRole;
  monthIndex: PlanningMonth;
};

function periodKeyOf(period: PlanningPeriodSummary): string {
  return makePeriodKey(period.year, period.quarter);
}

function LoadingShell() {
  return (
    <div role="status" className="mx-auto max-w-[1180px] px-4 py-6 text-[13px] text-neutral-500 md:px-6">
      投資計画を読み込み中…
    </div>
  );
}

export default function PlanningWorkspace({
  portfolioId,
  portfolioName,
  backHref,
  initialPeriod,
  initialView,
}: {
  portfolioId: number;
  portfolioName: string;
  backHref: string;
  initialPeriod: string | null;
  initialView: PlanningView;
}) {
  const [state, setState] = useState<PlanningState | null>(null);
  const [periodKey, setPeriodKey] = useState<string | null>(initialPeriod);
  const [view, setView] = useState<PlanningView>(initialView);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [conflictNotice, setConflictNotice] = useState("");
  const [initiativeDialog, setInitiativeDialog] = useState<InitiativeDialogState | null>(null);
  const [periodDialog, setPeriodDialog] = useState(false);
  const [budgetDialog, setBudgetDialog] = useState(false);
  const [capacityDialog, setCapacityDialog] = useState(false);
  const [rolesDialog, setRolesDialog] = useState(false);
  const [viewersDialog, setViewersDialog] = useState(false);
  const [resolvingChange, setResolvingChange] = useState(false);
  const [approvalSettingsDialog, setApprovalSettingsDialog] = useState(false);
  const [carryoverDialog, setCarryoverDialog] = useState(false);
  const [adoptSlot, setAdoptSlot] = useState<0 | 1 | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownState | null>(null);

  const load = useCallback(
    async (key: string | null, background: boolean) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const query = key ? `?period=${encodeURIComponent(key)}` : "";
        const data = await api<PlanningState>(`/api/portfolios/${portfolioId}/planning${query}`);
        setState(data);
        setPeriodKey(data.selectedPeriod ? periodKeyOf(data.selectedPeriod) : null);
        setError("");
      } catch (caught) {
        setError(planningErrorMessage(caught));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [portfolioId],
  );

  const loadInitial = useCallback(
    async (key: string | null) => {
      try {
        const query = key ? `?period=${encodeURIComponent(key)}` : "";
        const data = await api<PlanningState>(`/api/portfolios/${portfolioId}/planning${query}`);
        setState(data);
        setPeriodKey(data.selectedPeriod ? periodKeyOf(data.selectedPeriod) : null);
        setError("");
      } catch (caught) {
        setError(planningErrorMessage(caught));
      } finally {
        setLoading(false);
      }
    },
    [portfolioId],
  );

  useEffect(() => {
    // Initial client-side load; the server still enforces plan access.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInitial(initialPeriod);
  }, [loadInitial, initialPeriod]);

  const replaceUrl = (nextView: PlanningView, nextKey: string | null) => {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams();
    query.set("view", nextView);
    if (nextKey) query.set("period", nextKey);
    window.history.replaceState(null, "", `/portfolio/${portfolioId}/planning?${query.toString()}`);
  };

  const switchView = (next: PlanningView) => {
    setView(next);
    replaceUrl(next, periodKey);
  };

  const switchPeriod = (period: PlanningPeriodSummary) => {
    const key = periodKeyOf(period);
    setPeriodKey(key);
    replaceUrl(view, key);
    void load(key, true);
  };

  const mutate = async <T,>(path: string, method: string, body: unknown): Promise<T> => {
    try {
      const result = await api<T>(path, method, body);
      await load(periodKey, true);
      return result;
    } catch (caught) {
      if (isStaleRevisionError(caught)) {
        await load(periodKey, true);
        setConflictNotice(
          "他の担当者が前提を更新しました。最新の内容を再表示しました。入力中の内容は保持されています。",
        );
      }
      throw caught;
    }
  };

  const selectedPeriod = state?.selectedPeriod ?? null;
  const canEdit = state?.access.canEdit ?? false;
  const canEditData = state?.access.canEditData ?? false;

  const saveInitiative = async (input: InitiativeSaveInput) => {
    if (!selectedPeriod || !initiativeDialog) return;
    if (initiativeDialog.initiativeId === null) {
      await mutate(`/api/portfolios/${portfolioId}/planning/initiatives`, "POST", {
        periodId: selectedPeriod.id,
        revision: selectedPeriod.revision,
        ...input,
      });
      toast("案件を登録しました");
    } else {
      await mutate(
        `/api/portfolios/${portfolioId}/planning/initiatives/${initiativeDialog.initiativeId}`,
        "PATCH",
        {
          periodId: selectedPeriod.id,
          revision: selectedPeriod.revision,
          ...input,
        },
      );
      toast("案件の変更を保存しました");
    }
    setInitiativeDialog(null);
  };

  const removeInitiative = async () => {
    if (!selectedPeriod || !initiativeDialog?.initiativeId) return;
    const initiative = state?.initiatives.find((entry) => entry.id === initiativeDialog.initiativeId);
    const ok = await confirmAction(
      `「${initiative?.name ?? "この案件"}」を${selectedPeriod.label}の台帳から外しますか？\n他の四半期で見積もりがなければ、案件自体も削除されます。採用済みの決定履歴は変更されません。`,
      { title: "案件を外す", confirmLabel: "外す" },
    );
    if (!ok) return;
    await mutate(
      `/api/portfolios/${portfolioId}/planning/initiatives/${initiativeDialog.initiativeId}?periodId=${selectedPeriod.id}&revision=${selectedPeriod.revision}`,
      "DELETE",
      undefined,
    );
    toast("案件を台帳から外しました");
    setInitiativeDialog(null);
  };

  const saveBudget = async (budgetYen: number) => {
    if (!selectedPeriod) return;
    await mutate(
      `/api/portfolios/${portfolioId}/planning/periods/${selectedPeriod.id}`,
      "PATCH",
      { revision: selectedPeriod.revision, budgetYen },
    );
    setBudgetDialog(false);
    toast("予算上限を更新しました");
  };

  const saveCapacities = async (
    capacities: { roleId: number; monthIndex: PlanningMonth; days: number | null }[],
  ) => {
    if (!selectedPeriod) return;
    await mutate(
      `/api/portfolios/${portfolioId}/planning/periods/${selectedPeriod.id}/capacity`,
      "PUT",
      { revision: selectedPeriod.revision, capacities },
    );
    setCapacityDialog(false);
    toast("配賦枠を更新しました");
  };

  const saveRoles = async (roles: { id: number | null; name: string }[]) => {
    if (!selectedPeriod) return;
    await mutate(`/api/portfolios/${portfolioId}/planning/roles`, "PUT", {
      periodId: selectedPeriod.id,
      revision: selectedPeriod.revision,
      roles,
    });
    setRolesDialog(false);
    toast("職種を更新しました");
  };

  const attachInitiative = async (initiativeId: number) => {
    if (!selectedPeriod) return;
    await mutate(
      `/api/portfolios/${portfolioId}/planning/periods/${selectedPeriod.id}/carryovers`,
      "POST",
      { revision: selectedPeriod.revision, initiativeId },
    );
    toast("既存の案件をこの四半期に追加しました");
  };

  const toggleScenario = async (slot: 0 | 1, initiativeId: number, checked: boolean) => {
    if (!selectedPeriod || !state?.scenarios) return;
    const scenario = state.scenarios.find((entry) => entry.slot === slot);
    if (!scenario) return;
    const ids = new Set(scenario.selectedInitiativeIds);
    if (checked) ids.add(initiativeId);
    else ids.delete(initiativeId);
    await mutate(
      `/api/portfolios/${portfolioId}/planning/periods/${selectedPeriod.id}/scenarios/${slot}`,
      "PUT",
      { revision: selectedPeriod.revision, initiativeIds: [...ids] },
    );
    toast(`${slot === 0 ? "A案" : "B案"}の組み合わせを保存しました`);
  };

  const adopt = async (input: { chosenSlot: 0 | 1; reason: string; requestId: string }) => {
    if (!selectedPeriod) return;
    await mutate(
      `/api/portfolios/${portfolioId}/planning/periods/${selectedPeriod.id}/decisions`,
      "POST",
      { revision: selectedPeriod.revision, ...input },
    );
    setAdoptSlot(null);
    toast("採用時点の内容を決定履歴に記録しました");
  };

  const submitProposal = async (input: ProposalSubmitInput) => {
    if (!selectedPeriod) return;
    const result = await mutate<{ version: number }>(
      `/api/portfolios/${portfolioId}/planning/proposals`,
      "POST",
      { periodId: selectedPeriod.id, revision: selectedPeriod.revision, ...input },
    );
    toast(`投資提案を提出しました（版${result.version}）`);
  };

  const reviewProposal = async (proposalId: number, input: ProposalReviewInput) => {
    const result = await mutate<{ status: string }>(
      `/api/portfolios/${portfolioId}/planning/proposals/${proposalId}/review`,
      "POST",
      input,
    );
    toast(
      result.status === "returned"
        ? "投資提案を差し戻しました。新しい版を提出できます"
        : "レビューを確認し、最終決裁待ちにしました",
    );
  };

  const decideProposal = async (proposalId: number, input: ProposalDecisionInput) => {
    const result = await mutate<{
      status: string;
      action: ProposalDecisionInput["action"];
    }>(
      `/api/portfolios/${portfolioId}/planning/proposals/${proposalId}/decision`,
      "POST",
      input,
    );
    toast(
      result.action === "approve"
        ? "提案を承認し、提出時点の内容を決定履歴に採用しました"
        : result.action === "defer"
          ? "提案を今期見送りとして記録しました"
          : "提案を差し戻しました。新しい版を提出できます",
    );
  };

  const withdrawProposal = async (proposalId: number, input: ProposalWithdrawInput) => {
    await mutate(
      `/api/portfolios/${portfolioId}/planning/proposals/${proposalId}/withdraw`,
      "POST",
      input,
    );
    toast("提案を取り下げました。現在の計画で新しい版を提出できます");
  };

  const saveApprovalSettings = async (input: ApprovalSettingsInput) => {
    const result = await api<{ pendingId: number | null }>(
      `/api/portfolios/${portfolioId}/planning/approval-settings`, "PUT", { ...input, requestChange: true },
    );
    await load(periodKey, true);
    toast(result.pendingId ? "承認設定の変更を申請しました" : input.enabled ? "承認フローを有効にしました" : "承認フローを無効にしました");
  };

  const resolveChange = async (id: number, action: "confirm" | "cancel") => {
    if (resolvingChange) return;
    setResolvingChange(true);
    try {
      await api(`/api/portfolios/${portfolioId}/planning/approval-settings`, "POST", { changeId: id, action });
      toast(action === "confirm" ? "承認設定の変更を反映しました" : "設定変更の申請を取り消しました");
      await load(periodKey, true);
    } catch (error) {
      toast(planningErrorMessage(error));
    } finally {
      setResolvingChange(false);
    }
  };

  const createPeriod = async (input: {
    year: number;
    quarter: 1 | 2 | 3 | 4;
    budgetYen: number;
    roles: string[];
  }) => {
    const result = await api<{ year: number; quarter: 1 | 2 | 3 | 4 }>(
      `/api/portfolios/${portfolioId}/planning/periods`,
      "POST",
      input,
    );
    const key = makePeriodKey(result.year, result.quarter);
    setPeriodDialog(false);
    setView("ledger");
    setPeriodKey(key);
    replaceUrl("ledger", key);
    await load(key, true);
    toast("計画期間を作成しました");
  };

  const addViewer = async (userId: number) => {
    await mutate(`/api/portfolios/${portfolioId}/planning/viewers`, "POST", { userId });
    toast("閲覧者を追加しました");
  };

  const removeViewer = async (userId: number) => {
    await mutate(`/api/portfolios/${portfolioId}/planning/viewers/${userId}`, "DELETE", undefined);
    toast("閲覧者を外しました");
  };

  if (loading && !state) return <LoadingShell />;

  if (!state) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-8 md:px-6">
        <h1 className="text-[20px] font-semibold text-neutral-900">投資計画</h1>
        <div className="mt-3">
          <Notice tone="error">{error || "投資計画を読み込めませんでした。"}</Notice>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={buttonSecondary} onClick={() => void load(periodKey, false)}>
            再読み込み
          </button>
          <a href={backHref} className={buttonPrimary}>
            ポートフォリオに戻る
          </a>
        </div>
      </div>
    );
  }

  const initiative = initiativeDialog?.initiativeId
    ? state.initiatives.find((entry) => entry.id === initiativeDialog.initiativeId)
    : undefined;
  const pendingChange = state.pendingApprovalChange;
  const adopterResult = adoptSlot === null ? null : scenarioCalculation(state, adoptSlot);

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-5 md:px-6 md:py-6">
      <PlanningHeader
        portfolioName={state.portfolio.name || portfolioName}
        backHref={backHref}
        periods={state.periods}
        selectedPeriod={selectedPeriod}
        view={view}
        canEdit={canEdit}
        canManageViewers={state.access.canManageViewers}
        approvalEnabled={state.approval.enabled}
        restricted={state.restricted}
        onView={switchView}
        onPeriod={switchPeriod}
        onNewPeriod={() => setPeriodDialog(true)}
        onManageViewers={() => setViewersDialog(true)}
        onApprovalSettings={() => setApprovalSettingsDialog(true)}
      />

      {pendingChange && (
        <section aria-label="承認設定の変更申請" className="mt-3 space-y-2 rounded border p-3 text-sm">
          <h2 className="font-semibold">承認設定の変更申請</h2>
          <p>現在の最終承認者　{state.approval.finalApprover?.name ?? "未設定"}</p>
          <p>申請者　{pendingChange.requester} ／ 変更後の設定　{pendingChange.description}</p>
          {pendingChange.canConfirm && (
            <button type="button" className={buttonPrimary} disabled={resolvingChange || state.approval.openProposalCount > 0}
              onClick={() => void resolveChange(pendingChange.id, "confirm")}>設定変更を承認</button>
          )}
          {(canEdit || pendingChange.canConfirm) && (
            <button type="button" className={buttonSecondary} disabled={resolvingChange}
              onClick={() => void resolveChange(pendingChange.id, "cancel")}>変更申請を取り消す</button>
          )}
        </section>
      )}
      {state.settingsHistory.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer">承認設定の変更履歴（直近20件）</summary>
          <ul className="mt-2 space-y-2">
            {state.settingsHistory.map(entry => (
              <li key={entry.id}>
                <time dateTime={entry.at}>{new Date(entry.at).toLocaleString("ja-JP")}</time>　{entry.actor}　
                {entry.action.endsWith("_request") ? "申請" : entry.action.endsWith("_cancel") ? "取消" : "反映"}　{entry.summary}
              </li>
            ))}
          </ul>
        </details>
      )}
      {refreshing && (
        <p role="status" className="mt-3 text-[11px] text-neutral-500">
          最新の内容を読み込み中…
        </p>
      )}
      {error && state && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {conflictNotice && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Notice tone="warn">{conflictNotice}</Notice>
          <button type="button" className={buttonSecondary} onClick={() => setConflictNotice("")}>
            閉じる
          </button>
        </div>
      )}
      {state.restricted && (
        <div className="mt-3">
          <Notice tone="warn">{state.restrictedReason}</Notice>
        </div>
      )}

      <div className="mt-5">
        {!selectedPeriod ? (
          <EmptyPanel
            title="計画期間と予算を設定"
            actions={
              canEdit ? (
                <button type="button" className={buttonPrimary} onClick={() => setPeriodDialog(true)}>
                  計画期間と予算を設定
                </button>
              ) : undefined
            }
          >
            {canEdit
              ? "最初に対象四半期と期間予算を設定します。案件台帳、職種別の余力、2案比較の順に進められます。"
              : "計画期間はまだ作成されていません。ポートフォリオの所有者または管理者に作成を依頼してください。"}
          </EmptyPanel>
        ) : view === "ledger" ? (
          <LedgerView
            state={state}
            onNew={(focusLink) => setInitiativeDialog({ initiativeId: null, focusLink })}
            onEdit={(entry) => setInitiativeDialog({ initiativeId: entry.id, focusLink: false })}
            onEditBudget={() => setBudgetDialog(true)}
            onOpenCarryovers={() => setCarryoverDialog(true)}
            onNavigate={switchView}
          />
        ) : view === "capacity" ? (
          <CapacityView
            state={state}
            onEditCapacity={() => setCapacityDialog(true)}
            onEditRoles={() => setRolesDialog(true)}
            onNavigate={switchView}
            onOpenBreakdown={(result, role, monthIndex) => setBreakdown({ result, role, monthIndex })}
          />
        ) : (
          <CompareView
            key={`compare-${selectedPeriod.id}`}
            state={state}
            onToggle={toggleScenario}
            onAdopt={(slot) => setAdoptSlot(slot)}
            onSubmitProposal={submitProposal}
            onReviewProposal={reviewProposal}
            onDecideProposal={decideProposal}
            onWithdrawProposal={withdrawProposal}
            onEditBudget={() => setBudgetDialog(true)}
            onNavigate={switchView}
          />
        )}
      </div>

      {initiativeDialog && selectedPeriod && (initiativeDialog.initiativeId === null || initiative) && (
        <InitiativeDialog
          open
          onClose={() => setInitiativeDialog(null)}
          period={selectedPeriod}
          roles={state.roles}
          projects={state.projects}
          initiatives={state.initiatives}
          carryovers={state.carryovers}
          ownerCandidates={state.ownerCandidates ?? []}
          currentUserId={state.currentUserId}
          initiative={initiative}
          focusLink={initiativeDialog.focusLink}
          onSave={saveInitiative}
          onRemove={initiativeDialog.initiativeId ? removeInitiative : undefined}
        />
      )}
      {periodDialog && (
        <PeriodDialog
          open
          onClose={() => setPeriodDialog(false)}
          onCreate={createPeriod}
          roles={state.roles}
        />
      )}
      {selectedPeriod && (
        <BudgetDialog
          open={budgetDialog}
          onClose={() => setBudgetDialog(false)}
          budgetYen={selectedPeriod.budgetYen}
          periodLabel={selectedPeriod.label}
          onSave={saveBudget}
        />
      )}
      {selectedPeriod && (
        <CapacityDialog
          open={capacityDialog}
          onClose={() => setCapacityDialog(false)}
          roles={state.roles}
          capacities={state.capacities}
          periodLabel={selectedPeriod.label}
          startMonth={selectedPeriod.startMonth}
          onSave={saveCapacities}
        />
      )}
      {selectedPeriod && (
        <CarryoverDialog
          open={carryoverDialog}
          onClose={() => setCarryoverDialog(false)}
          carryovers={state.carryovers}
          periodLabel={selectedPeriod.label}
          onAttach={attachInitiative}
        />
      )}
      {selectedPeriod && (
        <RolesDialog
          open={rolesDialog}
          onClose={() => setRolesDialog(false)}
          roles={state.roles}
          periodLabel={selectedPeriod.label}
          onSave={saveRoles}
        />
      )}
      {state.viewers && state.viewerCandidates && (
        <ViewersDialog
          open={viewersDialog}
          onClose={() => setViewersDialog(false)}
          viewers={state.viewers}
          candidates={state.viewerCandidates}
          onAdd={addViewer}
          onRemove={removeViewer}
        />
      )}
      {state.approvalCandidates && (
        <ApprovalSettingsDialog
          open={approvalSettingsDialog}
          onClose={() => setApprovalSettingsDialog(false)}
          settings={state.approval}
          candidates={state.approvalCandidates}
          onSave={saveApprovalSettings}
        />
      )}
      {adoptSlot !== null && selectedPeriod && (
        <AdoptDialog
          open
          onClose={() => setAdoptSlot(null)}
          result={adopterResult}
          period={selectedPeriod}
          canAdopt={canEditData}
          onAdopt={adopt}
        />
      )}
      <BreakdownDialog
        open={breakdown !== null}
        onClose={() => setBreakdown(null)}
        result={breakdown?.result ?? null}
        role={breakdown?.role ?? null}
        monthIndex={breakdown?.monthIndex ?? null}
        startMonth={selectedPeriod?.startMonth ?? 1}
      />
    </div>
  );
}
