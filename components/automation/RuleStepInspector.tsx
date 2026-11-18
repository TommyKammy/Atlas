"use client";

import { useEffect, useRef } from "react";
import type { RuleDescriptors } from "@/lib/automation/descriptors";
import { duplicateRuleAction, moveEditorItem, type RuleEditorDocument, type RuleEditorSelection } from "@/lib/automation/editor-model";
import RuleActionFields from "./RuleActionFields";
import RuleConditionFields from "./RuleConditionFields";
import type { RuleAction } from "@/lib/automation/types";
import { toast } from "@/lib/ui-feedback";

const inputClass = "mt-1 h-9 w-full rounded-md border border-line bg-field px-2 text-[13px] outline-none focus:border-accent";
const buttonBase = "rounded-md border border-line px-2 py-1.5 text-[12px] hover:bg-hover disabled:opacity-40";
const buttonClass = `${buttonBase} text-secondary`;
const dangerButtonClass = `${buttonBase} text-danger`;

export default function RuleStepInspector({ projectId, document, descriptors, selected, readOnly, onChange, onSelect, onClose, onAddAction, focusCondition }: {
  projectId: number; document: RuleEditorDocument; descriptors: RuleDescriptors; selected: RuleEditorSelection;
  readOnly: boolean; onChange: (document: RuleEditorDocument) => void; onSelect: (selection: RuleEditorSelection | null) => void;
  onClose: () => void; onAddAction: (branch?: number) => void;
  focusCondition?: { index: number; request: number } | null;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusCondition) return;
    const row = panel.current?.querySelector<HTMLElement>(`[data-rule-condition-index="${focusCondition.index}"]`);
    const target = row?.querySelector<HTMLElement>('input[aria-invalid="true"],select[aria-invalid="true"],textarea[aria-invalid="true"]')
      ?? row?.querySelector<HTMLElement>("input,select,textarea")
      ?? panel.current?.querySelector<HTMLElement>("[data-rule-clear-inactive-conditions]");
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }, [focusCondition]);
  const title = selected.kind === "trigger" ? "きっかけの設定" : selected.kind === "action" ? "アクションの設定" : selected.kind === "branch" ? "分岐の設定" : "共通の条件";
  const action = selected.kind === "action" ? (selected.branch === undefined ? document.actions : document.branches[selected.branch]?.actions)?.[selected.index] : null;
  const trigger = selected.kind === "trigger" ? document.triggers[selected.index] : null;
  const branch = selected.kind === "branch" ? document.branches[selected.index] : null;
  const updateAction = (next: RuleAction) => {
    if (selected.kind !== "action") return;
    next = { ...action, ...next };
    if (next.capability !== action?.capability) delete next.webhookActionId;
    if (selected.branch === undefined) onChange({ ...document, actions: document.actions.map((entry, index) => index === selected.index ? next : entry) });
    else onChange({ ...document, branches: document.branches.map((entry, index) => index === selected.branch
      ? { ...entry, actions: entry.actions.map((item, i) => i === selected.index ? next : item) } : entry) });
  };
  const modifyActions = (kind: "up" | "down" | "duplicate" | "delete") => {
    if (selected.kind !== "action" || !action) return;
    const list = selected.branch === undefined ? document.actions : document.branches[selected.branch].actions;
    const next = kind === "delete" ? list.filter((_, i) => i !== selected.index)
      : kind === "duplicate" ? [...list.slice(0, selected.index + 1), duplicateRuleAction(action), ...list.slice(selected.index + 1)]
        : moveEditorItem(list, selected.index, kind === "up" ? -1 : 1);
    if (selected.branch === undefined) onChange({ ...document, actions: next });
    else onChange({ ...document, branches: document.branches.map((entry, index) => index === selected.branch ? { ...entry, actions: next } : entry) });
    if (kind === "delete") onSelect(null);
    else onSelect({ ...selected, index: kind === "duplicate" ? selected.index + 1 : kind === "up" ? Math.max(0, selected.index - 1) : Math.min(list.length - 1, selected.index + 1) });
    if (kind === "duplicate" && action.capability === "webhook.post") toast("複製したWebhookの送信先とシークレットを設定してください");
  };
  const totalActions = document.useBranches ? document.branches.reduce((total, entry) => total + entry.actions.length, 0) : document.actions.length;
  return <aside ref={panel} aria-label={title} data-rule-inspector className="absolute inset-y-0 right-0 z-20 flex w-[min(360px,100%)] shrink-0 flex-col border-l border-line bg-surface shadow-lg xl:static xl:w-[340px] xl:shadow-none">
    <div className="flex items-center justify-between border-b border-line px-5 py-4">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <button type="button" aria-label="設定パネルを閉じる" onClick={onClose} className="h-7 w-7 rounded text-lg text-muted hover:bg-hover">×</button>
    </div>
    <fieldset disabled={readOnly} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 disabled:opacity-75">
      {trigger && selected.kind === "trigger" && <>
        <label className="block text-[12px] font-medium text-secondary">きっかけ
          <select className={inputClass} value={trigger.event} onChange={(event) => {
            const descriptor = descriptors.triggers.find((entry) => entry.id === event.target.value)!;
            onChange({ ...document, triggers: document.triggers.map((entry, index) => index === selected.index
              ? { event: descriptor.id as typeof trigger.event, ...(descriptor.days ? { days: descriptor.days.default } : {}) } : entry) });
          }}>{descriptors.triggers.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select>
        </label>
        <p className="text-[12px] leading-5 text-secondary">{descriptors.triggers.find((entry) => entry.id === trigger.event)?.description}</p>
        {descriptors.triggers.find((entry) => entry.id === trigger.event)?.days && <label className="block text-[12px] font-medium text-secondary">
          {descriptors.triggers.find((entry) => entry.id === trigger.event)!.days!.label}
          <input type="number" min={0} max={365} className={inputClass} value={trigger.days ?? descriptors.triggers.find((entry) => entry.id === trigger.event)!.days!.default}
            onChange={(event) => onChange({ ...document, triggers: document.triggers.map((entry, index) => index === selected.index ? { ...entry, days: Number(event.target.value) } : entry) })} />
          <span className="mt-1 block text-[11px] font-normal text-muted">日付は日本時間で判定します。</span>
        </label>}
        {trigger.filters && Object.keys(trigger.filters).length > 0 && <div className="rounded-md border border-line p-3 text-[12px] text-secondary">
          <p className="mb-2 font-medium">イベントの絞り込み</p>
          {Object.entries(trigger.filters).map(([key, value]) => <label key={key} className="mb-2 block">{key}<input className={inputClass} value={String(value)} onChange={(event) => onChange({ ...document, triggers: document.triggers.map((entry, index) => index === selected.index ? { ...entry, filters: { ...entry.filters, [key]: event.target.value } } : entry) })} /></label>)}
        </div>}
        <div className="flex gap-2">
          <button type="button" className={buttonClass} disabled={selected.index === 0} onClick={() => { onChange({ ...document, triggers: moveEditorItem(document.triggers, selected.index, -1) }); onSelect({ ...selected, index: selected.index - 1 }); }}>上へ</button>
          <button type="button" className={buttonClass} disabled={selected.index === document.triggers.length - 1} onClick={() => { onChange({ ...document, triggers: moveEditorItem(document.triggers, selected.index, 1) }); onSelect({ ...selected, index: selected.index + 1 }); }}>下へ</button>
          <button type="button" className={dangerButtonClass} onClick={() => { onChange({ ...document, triggers: document.triggers.filter((_, i) => i !== selected.index) }); onSelect(null); }}>削除</button>
        </div>
        <p className="text-[11px] leading-5 text-muted">複数のきっかけは、いずれかが発生したときに評価します。</p>
      </>}
      {selected.kind === "conditions" && <>
        <p className="text-[12px] leading-5 text-secondary">すべての条件に一致した場合に、その先のアクションや分岐を評価します。</p>
        <RuleConditionFields conditions={document.conditions} descriptors={descriptors} projectId={projectId} onChange={(conditions) => onChange({ ...document, conditions })} />
      </>}
      {branch && selected.kind === "branch" && <>
        <label className="block text-[12px] font-medium text-secondary">パス名<input className={inputClass} value={branch.name} maxLength={100} onChange={(event) => onChange({ ...document, branches: document.branches.map((entry, i) => i === selected.index ? { ...entry, name: event.target.value } : entry) })} /></label>
        <label className="flex items-center gap-2 text-[12px] text-secondary"><input type="checkbox" checked={branch.else === true} disabled={document.branches.some((entry, i) => i !== selected.index && entry.else)}
          onChange={(event) => onChange({ ...document, branches: document.branches.map((entry, i) => i === selected.index ? { ...entry, else: event.target.checked } : entry) })} />それ以外のパス</label>
        {branch.else ? <p className="text-[12px] leading-5 text-secondary">他のパスがどれも一致しない場合に実行します。</p> : <RuleConditionFields conditions={branch.conditions} descriptors={descriptors} projectId={projectId} onChange={(conditions) => onChange({ ...document, branches: document.branches.map((entry, i) => i === selected.index ? { ...entry, conditions } : entry) })} />}
        {branch.else && branch.conditions.length > 0 && <div className="space-y-2 rounded-md border border-warning-line bg-warning-soft p-3 text-[12px] leading-5 text-warning">
          <p>「それ以外のパス」では条件を使いません。残っている条件を削除するか、通常のパスに戻して修正してください。</p>
          <button type="button" data-rule-clear-inactive-conditions className={buttonClass} onClick={() => onChange({ ...document, branches: document.branches.map((entry, i) => i === selected.index ? { ...entry, conditions: [] } : entry) })}>残っている条件を削除</button>
        </div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => onAddAction(selected.index)}>＋ アクション</button>
          <button type="button" className={buttonClass} disabled={selected.index === 0} onClick={() => { onChange({ ...document, branches: moveEditorItem(document.branches, selected.index, -1) }); onSelect({ ...selected, index: selected.index - 1 }); }}>上へ</button>
          <button type="button" className={buttonClass} disabled={selected.index === document.branches.length - 1} onClick={() => { onChange({ ...document, branches: moveEditorItem(document.branches, selected.index, 1) }); onSelect({ ...selected, index: selected.index + 1 }); }}>下へ</button>
          <button type="button" className={buttonClass} disabled={document.branches.length >= 20 || totalActions + branch.actions.length > descriptors.limits.actionsPerRule} onClick={() => {
            const copy = { ...structuredClone(branch), name: `${branch.name}のコピー`, else: false, actions: branch.actions.map(duplicateRuleAction) };
            onChange({ ...document, branches: [...document.branches.slice(0, selected.index + 1), copy, ...document.branches.slice(selected.index + 1)] });
            onSelect({ kind: "branch", index: selected.index + 1 });
          }}>複製</button>
          <button type="button" className={dangerButtonClass} onClick={() => { onChange({ ...document, branches: document.branches.filter((_, i) => i !== selected.index) }); onSelect(null); }}>パスを削除</button>
        </div>
        <p className="text-[11px] leading-5 text-muted">「それ以外」は最後に評価します。通常のパスは上から最初に一致した1つだけを実行します。</p>
      </>}
      {action && selected.kind === "action" && <>
        <RuleActionFields action={action} descriptors={descriptors} projectId={projectId} triggers={document.triggers} onChange={updateAction} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={selected.index === 0} onClick={() => modifyActions("up")}>上へ</button>
          <button type="button" className={buttonClass} disabled={selected.index === (selected.branch === undefined ? document.actions : document.branches[selected.branch].actions).length - 1} onClick={() => modifyActions("down")}>下へ</button>
          <button type="button" className={buttonClass} disabled={totalActions >= descriptors.limits.actionsPerRule} onClick={() => modifyActions("duplicate")}>複製</button>
          <button type="button" className={dangerButtonClass} onClick={() => modifyActions("delete")}>アクションを削除</button>
        </div>
      </>}
      <p className="border-t border-line pt-4 text-[11px] leading-5 text-muted">変更内容は下書きに保存され、公開後に適用されます。</p>
    </fieldset>
  </aside>;
}
