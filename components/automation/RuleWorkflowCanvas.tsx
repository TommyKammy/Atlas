"use client";

import { useState, type ReactNode } from "react";
import type { RuleDescriptors } from "@/lib/automation/descriptors";
import { actionSummary, conditionSummary, editorProblems, editorSummary, type RuleEditorDocument, type RuleEditorSelection } from "@/lib/automation/editor-model";
import type { RuleAction } from "@/lib/automation/types";

function Arrow({ down = false }: { down?: boolean }) {
  return <div aria-hidden="true" className={down ? "flex h-7 justify-center text-neutral-300" : "flex w-8 shrink-0 items-center text-neutral-300"}>
    <svg width={down ? 16 : 32} height={down ? 28 : 16} viewBox={down ? "0 0 16 28" : "0 0 32 16"} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={down ? "M8 0v26m-4-5 4 5 4-5" : "M0 8h30m-5-4 5 4-5 4"} />
    </svg>
  </div>;
}

function Card({ title, category, children, selected, onClick, tone = "blue", testId, invalid }: {
  title: string; category?: string; children?: ReactNode; selected: boolean; onClick: () => void; tone?: "blue" | "amber"; testId: string;
  invalid?: boolean;
}) {
  return <button type="button" data-rule-node={testId} data-rule-node-invalid={invalid || undefined} aria-pressed={selected} onClick={onClick}
    className={`w-full rounded-lg border bg-white p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2c60b8] ${selected ? "border-accent bg-[#eff4fd] ring-1 ring-[#2c60b8]" : invalid ? "border-rose-300 hover:border-rose-500" : "border-neutral-200 hover:border-neutral-400"}`}>
    {category && <span className={`mb-2 block text-[11px] font-semibold ${tone === "amber" ? "text-amber-700" : "text-accent-text"}`}>{category}</span>}
    <span className="block break-words text-[13px] font-semibold text-neutral-900">{title}</span>
    {children && <span className="mt-2 block break-words text-[12px] leading-5 text-secondary">{children}</span>}
    {invalid && <span className="mt-2 block text-[11px] font-semibold text-rose-700">! 入力を確認してください</span>}
  </button>;
}

export default function RuleWorkflowCanvas({ document, descriptors, selected, readOnly, onSelect, onAddTrigger, onAddAction, onAddBranch, onToggleBranches, onUndo, onRedo, canUndo, canRedo }: {
  document: RuleEditorDocument; descriptors: RuleDescriptors; selected: RuleEditorSelection | null; readOnly: boolean;
  onSelect: (selection: RuleEditorSelection) => void; onAddTrigger: () => void; onAddAction: (branch?: number) => void;
  onAddBranch: () => void; onToggleBranches: () => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const problems = editorProblems(document, descriptors);
  const isSelected = (selection: RuleEditorSelection) => JSON.stringify(selection) === JSON.stringify(selected);
  const totalActions = document.useBranches ? document.branches.reduce((sum, branch) => sum + branch.actions.length, 0) : document.actions.length;
  const actionColumn = (actions: RuleAction[], branch?: number) => <div className="w-[260px] shrink-0">
    {actions.map((action, index) => <div key={index}>
      {index > 0 && <Arrow down />}
      <Card title={descriptors.actions.find((entry) => entry.id === action.capability)?.label ?? action.capability}
        category={index === 0 ? "実行すること" : undefined} testId={`action-${branch ?? "flat"}-${index}`}
        selected={isSelected({ kind: "action", index, ...(branch === undefined ? {} : { branch }) })}
        onClick={() => onSelect({ kind: "action", index, ...(branch === undefined ? {} : { branch }) })}>
        <span className="line-clamp-3">{actionSummary(action, descriptors)}</span>
      </Card>
    </div>)}
    {!readOnly && <button type="button" onClick={() => onAddAction(branch)} disabled={totalActions >= descriptors.limits.actionsPerRule}
      className="mt-4 w-full rounded-md border border-dashed border-neutral-300 bg-surface px-3 py-2 text-[12px] text-neutral-600 hover:border-[#2c60b8] hover:text-[#2c60b8] disabled:opacity-40">＋ アクション</button>}
  </div>;

  const branches = document.branches.map((branch, index) => ({ branch, index })).sort((a, b) => Number(Boolean(a.branch.else)) - Number(Boolean(b.branch.else)));
  return <section aria-label="ワークフロー" className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface-subtle">
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-200 bg-surface px-5 py-2 text-[11px] text-secondary">
      <span>きっかけ → 条件 → 実行すること</span>
      {document.useBranches && <span>分岐は上から最初に一致したパスを実行</span>}
      {document.useBranches && document.conditions.length === 0 && <button type="button" onClick={() => onSelect({ kind: "conditions" })} className="rounded px-2 py-1 text-accent-text hover:bg-blue-50">共通の条件を追加</button>}
      {!readOnly && <button type="button" aria-pressed={document.useBranches} onClick={onToggleBranches} className="ml-auto rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50">{document.useBranches ? "単純なフローに切り替え" : "条件で分岐する"}</button>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-6 sm:p-10" data-rule-canvas>
      <div style={{ zoom }} className="flex min-w-[870px] items-start gap-0 py-12">
        <div className="w-[230px] shrink-0 space-y-3">
          {document.triggers.map((trigger, index) => <Card key={index}
            title={descriptors.triggers.find((entry) => entry.id === trigger.event)?.label ?? trigger.event}
            category={index === 0 ? "きっかけ" : "または"} testId={`trigger-${index}`}
            selected={isSelected({ kind: "trigger", index })} onClick={() => onSelect({ kind: "trigger", index })}>
            {trigger.days !== undefined ? `${trigger.days}日${trigger.event === "task.overdue" ? "過ぎたら" : "前"}` : "クリックして設定"}
          </Card>)}
          {!readOnly && <button type="button" onClick={onAddTrigger} disabled={document.triggers.length >= descriptors.limits.triggersPerRule}
            className="w-full rounded-md border border-dashed border-neutral-300 bg-surface p-2 text-[12px] text-neutral-600 hover:text-[#2c60b8] disabled:opacity-40">＋ きっかけ</button>}
        </div>
        <div className="pt-12"><Arrow /></div>
        {(!document.useBranches || document.conditions.length > 0) && <><div className="w-[250px] shrink-0">
          <Card title={document.conditions.length ? "すべての条件に一致" : "条件を追加"} category="共通の条件" tone="amber" testId="conditions"
            invalid={problems.some((problem) => problem.selection?.kind === "conditions" && problem.conditionIndex !== undefined)}
            selected={isSelected({ kind: "conditions" })} onClick={() => onSelect({ kind: "conditions" })}>
            {document.conditions.length ? document.conditions.map((condition, index) => <span key={index} className="block">{conditionSummary(condition, descriptors)}</span>) : "任意の条件を設定できます"}
          </Card>
        </div>
        <div className="pt-12"><Arrow /></div></>}
        {document.useBranches ? <div className="space-y-8">
          {branches.map(({ branch, index }, order) => <div key={index} className="relative flex items-start">
            <span aria-hidden="true" className="absolute -left-4 border-l border-line-strong" style={{ top: order === 0 ? 56 : -32, bottom: order === branches.length - 1 ? "calc(100% - 56px)" : -32 }} />
            <span aria-hidden="true" className="absolute -left-4 top-14 w-4 border-t border-line-strong" />
            <div className="w-[250px] shrink-0">
              <Card title={branch.name} category={branch.else ? "それ以外" : `判定 ${order + 1}`} tone="amber" testId={`branch-${index}`}
                invalid={problems.some((problem) => problem.selection?.kind === "branch" && problem.selection.index === index && problem.conditionIndex !== undefined)}
                selected={isSelected({ kind: "branch", index })} onClick={() => onSelect({ kind: "branch", index })}>
                {branch.else ? "他のパスに一致しない場合" : branch.conditions.length ? branch.conditions.map((condition, i) => <span key={i} className="block">{conditionSummary(condition, descriptors)}</span>) : "常に一致"}
              </Card>
            </div>
            <div className="pt-12"><Arrow /></div>{actionColumn(branch.actions, index)}
          </div>)}
          {!readOnly && <button type="button" onClick={onAddBranch} disabled={document.branches.length >= 20}
            className="rounded-md border border-dashed border-line-strong bg-surface px-4 py-2 text-[12px] text-secondary disabled:opacity-40">＋ 分岐を追加</button>}
        </div> : actionColumn(document.actions)}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-2 px-5 pb-3">
      <div className="flex items-center rounded-md border border-neutral-200 bg-surface text-[12px]">
        <button type="button" aria-label="縮小" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))} className="h-8 px-3 disabled:opacity-30">−</button>
        <button type="button" aria-label="ズームをリセット" onClick={() => setZoom(1)} className="h-8 px-2">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="拡大" disabled={zoom >= 1.5} onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))} className="h-8 px-3 disabled:opacity-30">＋</button>
      </div>
      <button type="button" onClick={onUndo} disabled={!canUndo || readOnly} aria-label="元に戻す" className="h-8 rounded-md border border-neutral-200 bg-surface px-3 text-sm disabled:opacity-30">↶</button>
      <button type="button" onClick={onRedo} disabled={!canRedo || readOnly} aria-label="やり直す" className="h-8 rounded-md border border-neutral-200 bg-surface px-3 text-sm disabled:opacity-30">↷</button>
    </div>
    <div className="mx-4 mb-4 rounded-lg border border-neutral-200 bg-surface p-3 text-[12px] leading-5 text-secondary">
      <span className="mr-3 font-semibold text-neutral-800">このルールの動作</span>{editorSummary(document, descriptors)}
    </div>
  </section>;
}
