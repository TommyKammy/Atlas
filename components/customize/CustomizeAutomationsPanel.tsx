"use client";

import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  type ProjectAutomation,
} from "@/lib/automations";

/** Automation rules list plus the local AI suggestion box. */
export default function CustomizeAutomationsPanel({
  rules,
  canEdit,
  aiPrompt,
  onAiPrompt,
  onAiSuggest,
  onAdd,
  onToggle,
  onRemove,
  secondaryButton,
}: {
  rules: ProjectAutomation[];
  canEdit: boolean;
  aiPrompt: string;
  onAiPrompt: (value: string) => void;
  onAiSuggest: () => void;
  onAdd: () => void;
  onToggle: (rule: ProjectAutomation) => void;
  onRemove: (rule: ProjectAutomation) => void;
  secondaryButton: string;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] text-neutral-600">
          タスクの作成・完了・Status変更をきっかけに、Status変更・担当者変更・コメント追加を自動実行します。
        </p>
        {canEdit && (
          <button type="button" data-customize-automation-add onClick={onAdd} className={secondaryButton}>
            ＋ ルール
          </button>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-[#dbe7fb] bg-[#f5f9ff] p-3">
        <div className="text-[12px] font-semibold text-[#24529c]">AIアシスト（ローカル提案）</div>
        <div className="mt-2 flex gap-2">
          <input
            value={aiPrompt}
            onChange={(event) => onAiPrompt(event.target.value)}
            data-customize-ai-prompt
            placeholder="例: 新規タスクを進行中にして"
            className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[12px] outline-none focus:border-[#2c60b8]"
          />
          <button
            type="button"
            data-customize-ai-suggest
            onClick={onAiSuggest}
            className="h-8 shrink-0 rounded-md bg-[#2c60b8] px-3 text-[12px] font-medium text-white hover:bg-[#24529c]"
          >
            提案
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center text-[13px] text-neutral-500">
            自動化ルールはありません。
          </div>
        ) : (
          rules.map((rule) => {
            const triggerLabel =
              AUTOMATION_TRIGGERS.find((entry) => entry.value === rule.trigger)?.label ?? rule.trigger;
            const actionLabel =
              AUTOMATION_ACTIONS.find((entry) => entry.value === rule.action_type)?.label ?? rule.action_type;
            return (
              <div
                key={rule.id}
                data-customize-automation={rule.id}
                className="rounded-lg border border-[#e1e1e1] bg-white px-4 py-3"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-neutral-900">{rule.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          rule.enabled ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-500"
                        }`}
                      >
                        {rule.enabled ? "有効" : "無効"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {triggerLabel} → {actionLabel}: {rule.action_value}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        data-customize-automation-toggle={rule.id}
                        onClick={() => onToggle(rule)}
                        className="h-7 rounded-md border border-[#e1e1e1] px-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
                      >
                        {rule.enabled ? "無効化" : "有効化"}
                      </button>
                      <button
                        type="button"
                        data-customize-automation-remove={rule.id}
                        aria-label={`${rule.name}を削除`}
                        onClick={() => onRemove(rule)}
                        className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-600"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
