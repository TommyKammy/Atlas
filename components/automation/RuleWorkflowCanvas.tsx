"use client";

import { useState, type ReactNode } from "react";
import type { RuleDescriptors } from "@/lib/automation/descriptors";
import { actionSummary, conditionSummary, editorProblems, editorSummary, type RuleEditorDocument, type RuleEditorSelection } from "@/lib/automation/editor-model";
import type { RuleAction } from "@/lib/automation/types";
import { secondaryButtonClass } from "../ui/form-controls";

function Arrow({ down = false }: { down?: boolean }) {
  return <div aria-hidden="true" className={down ? "flex h-7 justify-center text-line-strong" : "flex w-8 shrink-0 items-center text-line-strong"}>
    <svg width={down ? 16 : 32} height={down ? 28 : 16} viewBox={down ? "0 0 16 28" : "0 0 32 16"} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={down ? "M8 0v26m-4-5 4 5 4-5" : "M0 8h30m-5-4 5 4-5 4"} />
    </svg>
  </div>;
}

function Card({ title, category, children, selected, onClick, testId, invalid }: {
  title: string; category?: string; children?: ReactNode; selected: boolean; onClick: () => void; testId: string;
  invalid?: boolean;
}) {
  return <button type="button" data-rule-node={testId} data-rule-node-invalid={invalid || undefined} aria-pressed={selected} onClick={onClick}
    className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${selected ? "border-2 border-accent bg-accent-soft" : invalid ? "border-danger-line bg-surface hover:border-danger" : "border-line bg-surface hover:border-line-strong"}`}>
    {category && <span className="mb-1.5 block text-[12px] font-medium text-muted">{category}</span>}
    <span className="block break-words text-[13px] font-semibold text-text">{title}</span>
    {children && <span className="mt-1.5 block break-words text-[12px] leading-5 text-secondary">{children}</span>}
    {invalid && <span className="mt-2 block text-[12px] font-medium text-danger"><span aria-hidden="true" className="mr-1 font-semibold">!</span>入力を確認してください</span>}
  </button>;
}

const addButtonClass = "w-full rounded-md border border-dashed border-line-strong bg-transparent px-3 text-[12px] text-secondary hover:bg-hover disabled:opacity-40";

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
      className={`${addButtonClass} mt-4 h-8`}>＋ アクション</button>}
  </div>;

  const branches = document.branches.map((branch, index) => ({ branch, index })).sort((a, b) => Number(Boolean(a.branch.else)) - Number(Boolean(b.branch.else)));
  return <section aria-label="ワークフロー" className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-2 text-[12px] text-muted">
      <span>きっかけ → 条件 → 実行すること</span>
      {document.useBranches && <span>分岐は上から最初に一致したパスを実行</span>}
      {document.useBranches && document.conditions.length === 0 && <button type="button" onClick={() => onSelect({ kind: "conditions" })} className="h-8 rounded-md px-2 text-accent-text hover:bg-accent-soft">共通の条件を追加</button>}
      {!readOnly && <button type="button" aria-pressed={document.useBranches} onClick={onToggleBranches} className={`${secondaryButtonClass} ml-auto`}>{document.useBranches ? "単純なフローに切り替え" : "条件で分岐する"}</button>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-6 sm:p-10" data-rule-canvas>
      <div style={{ zoom }} className="flex min-w-[870px] items-start gap-0 py-8">
        <div className="w-[230px] shrink-0 space-y-3">
          {document.triggers.map((trigger, index) => <Card key={index}
            title={descriptors.triggers.find((entry) => entry.id === trigger.event)?.label ?? trigger.event}
            category={index === 0 ? "きっかけ" : "または"} testId={`trigger-${index}`}
            selected={isSelected({ kind: "trigger", index })} onClick={() => onSelect({ kind: "trigger", index })}>
            {trigger.days !== undefined ? `${trigger.days}日${trigger.event === "task.overdue" ? "過ぎたら" : "前"}` : "クリックして設定"}
          </Card>)}
          {!readOnly && <button type="button" onClick={onAddTrigger} disabled={document.triggers.length >= descriptors.limits.triggersPerRule}
            className={`${addButtonClass} h-8`}>＋ きっかけ</button>}
        </div>
        <div className="pt-11"><Arrow /></div>
        {(!document.useBranches || document.conditions.length > 0) && <><div className="w-[250px] shrink-0">
          <Card title={document.conditions.length ? "すべての条件に一致" : "条件を追加"} category="共通の条件" testId="conditions"
            invalid={problems.some((problem) => problem.selection?.kind === "conditions" && problem.conditionIndex !== undefined)}
            selected={isSelected({ kind: "conditions" })} onClick={() => onSelect({ kind: "conditions" })}>
            {document.conditions.length ? document.conditions.map((condition, index) => <span key={index} className="block">{conditionSummary(condition, descriptors)}</span>) : "任意の条件を設定できます"}
          </Card>
        </div>
        <div className="pt-11"><Arrow /></div></>}
        {document.useBranches ? <div className="space-y-8">
          {branches.map(({ branch, index }, order) => <div key={index} className="relative flex items-start">
            <span aria-hidden="true" className="absolute -left-4 border-l border-line-strong" style={{ top: order === 0 ? 52 : -32, bottom: order === branches.length - 1 ? "calc(100% - 52px)" : -32 }} />
            <span aria-hidden="true" className="absolute -left-4 top-[52px] w-4 border-t border-line-strong" />
            <div className="w-[250px] shrink-0">
              <Card title={branch.name} category={branch.else ? "それ以外" : `判定 ${order + 1}`} testId={`branch-${index}`}
                invalid={problems.some((problem) => problem.selection?.kind === "branch" && problem.selection.index === index && problem.conditionIndex !== undefined)}
                selected={isSelected({ kind: "branch", index })} onClick={() => onSelect({ kind: "branch", index })}>
                {branch.else ? "他のパスに一致しない場合" : branch.conditions.length ? branch.conditions.map((condition, i) => <span key={i} className="block">{conditionSummary(condition, descriptors)}</span>) : "常に一致"}
              </Card>
            </div>
            <div className="pt-11"><Arrow /></div>{actionColumn(branch.actions, index)}
          </div>)}
          {!readOnly && <button type="button" onClick={onAddBranch} disabled={document.branches.length >= 20}
            className="h-8 rounded-md border border-dashed border-line-strong bg-transparent px-3 text-[12px] text-secondary hover:bg-hover disabled:opacity-40">＋ 分岐を追加</button>}
        </div> : actionColumn(document.actions)}
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-surface px-4 py-2">
      <div className="flex shrink-0 items-center rounded-md border border-line bg-surface text-[12px]">
        <button type="button" aria-label="縮小" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))} className="h-8 px-2.5 text-secondary hover:bg-hover disabled:opacity-30">−</button>
        <button type="button" aria-label="ズームをリセット" onClick={() => setZoom(1)} className="h-8 px-2 tabular-nums text-secondary hover:bg-hover">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="拡大" disabled={zoom >= 1.5} onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))} className="h-8 px-2.5 text-secondary hover:bg-hover disabled:opacity-30">＋</button>
      </div>
      <button type="button" onClick={onUndo} disabled={!canUndo || readOnly} aria-label="元に戻す" className={secondaryButtonClass}>↶</button>
      <button type="button" onClick={onRedo} disabled={!canRedo || readOnly} aria-label="やり直す" className={secondaryButtonClass}>↷</button>
      <p className="min-w-0 flex-1 basis-64 text-[12px] leading-5 text-muted"><span className="mr-2 font-medium text-text">このルールの動作</span>{editorSummary(document, descriptors)}</p>
    </div>
  </section>;
}
