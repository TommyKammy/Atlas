import type { RuleDescriptors } from "@/lib/automation/descriptors";
import type { RuleConditionEvaluation, RuleEvaluationTrace } from "@/lib/automation/evaluation";

function display(value: unknown) {
  if (value === undefined) return "未設定";
  if (value === null || value === "") return "空";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export default function RuleEvaluationDetails({ trace, descriptors }: { trace: RuleEvaluationTrace; descriptors: RuleDescriptors }) {
  const conditions = (items: RuleConditionEvaluation[]) => <ul className="mt-2 space-y-2">
    {items.map((item) => <li key={item.index} className="rounded-md bg-surface-subtle p-3 text-[12px] text-neutral-700">
      <span className="mr-2 font-medium">{item.matched === true ? "✓ 一致" : item.matched === false ? "× 不一致" : "− 未評価"}</span>
      {descriptors.conditionFields.find((entry) => entry.id === item.field)?.label ?? item.field}
      <span className="mt-1 block text-muted">{item.reason}</span>
      {Object.hasOwn(item, "actual") && <span className="mt-1 block break-words text-[11px]">現在の値: {display(item.actual)} / 比較する値: {display(item.value)}</span>}
    </li>)}
  </ul>;
  return <div className="space-y-4" data-rule-evaluation>
    <p className="rounded-md border border-neutral-200 p-3 text-[13px] font-medium">{trace.matched ? "✓ 実行するパスが見つかりました" : "− アクションは実行されません"}<span className="mt-1 block text-[12px] font-normal text-secondary">{trace.reason}</span></p>
    <div><h3 className="text-[12px] font-semibold text-neutral-800">きっかけ</h3><ul className="mt-2 space-y-2">{trace.triggers.map((trigger) => <li key={trigger.index} className="text-[12px] text-secondary">{trigger.matched ? "✓" : "−"} {descriptors.triggers.find((entry) => entry.id === trigger.event)?.label ?? trigger.event}<span className="ml-2 text-muted">{trigger.reason}</span></li>)}</ul></div>
    {trace.conditions.length > 0 && <div><h3 className="text-[12px] font-semibold text-neutral-800">共通の条件</h3>{conditions(trace.conditions)}</div>}
    {trace.branches.map((branch) => <div key={branch.index} className={`rounded-lg border p-3 ${branch.selected ? "border-accent bg-accent-soft" : "border-neutral-200"}`}>
      <p className="text-[12px] font-semibold">{branch.selected ? "✓ 選択されたパス" : branch.evaluated ? "− 選択されなかったパス" : "− 未評価のパス"} · {branch.name}</p>
      <p className="mt-1 text-[11px] text-muted">{branch.reason}</p>{conditions(branch.conditions)}
    </div>)}
  </div>;
}
