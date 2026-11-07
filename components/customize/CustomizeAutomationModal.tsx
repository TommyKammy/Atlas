"use client";

import type { FormEvent } from "react";
import type { User } from "@/lib/data";
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  type AutomationAction,
  type AutomationTrigger,
} from "@/lib/automations";
import CustomizeModal from "./CustomizeModal";

export type AutomationDraft = {
  name: string;
  trigger: AutomationTrigger;
  action_type: AutomationAction;
  action_value: string;
};

/** Create automation rule modal. */
export default function CustomizeAutomationModal({
  draft,
  onDraft,
  onClose,
  onSubmit,
  users,
  statusValues,
  busy,
  fieldTypeClass,
  primaryButton,
  secondaryButton,
}: {
  draft: AutomationDraft;
  onDraft: (draft: AutomationDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  users: User[];
  statusValues: string[];
  busy: boolean;
  fieldTypeClass: string;
  primaryButton: string;
  secondaryButton: string;
}) {
  return (
    <CustomizeModal title="自動化ルール" onClose={onClose}>
      <form onSubmit={onSubmit} data-customize-automation-form className="p-5">
        <label className="block text-[12px] font-medium text-neutral-700">
          ルール名
          <input
            value={draft.name}
            onChange={(event) => onDraft({ ...draft, name: event.target.value })}
            data-customize-automation-name
            placeholder="例: 新規タスクを進行中にする"
            className={fieldTypeClass}
          />
        </label>
        <label className="mt-3 block text-[12px] font-medium text-neutral-700">
          きっかけ
          <select
            value={draft.trigger}
            onChange={(event) => onDraft({ ...draft, trigger: event.target.value as AutomationTrigger })}
            data-customize-automation-trigger
            className={fieldTypeClass}
          >
            {AUTOMATION_TRIGGERS.map((trigger) => (
              <option key={trigger.value} value={trigger.value}>
                {trigger.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-[12px] font-medium text-neutral-700">
          アクション
          <select
            value={draft.action_type}
            onChange={(event) =>
              onDraft({
                ...draft,
                action_type: event.target.value as AutomationAction,
                action_value:
                  event.target.value === "set_status"
                    ? statusValues[0] ?? "未着手"
                    : event.target.value === "set_assignee"
                      ? String(users[0]?.id ?? "")
                      : "",
              })
            }
            data-customize-automation-action
            className={fieldTypeClass}
          >
            {AUTOMATION_ACTIONS.map((action) => (
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-[12px] font-medium text-neutral-700">
          値
          {draft.action_type === "set_status" ? (
            <select
              value={draft.action_value}
              onChange={(event) => onDraft({ ...draft, action_value: event.target.value })}
              data-customize-automation-value
              className={fieldTypeClass}
            >
              {statusValues.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : draft.action_type === "set_assignee" ? (
            <select
              value={draft.action_value}
              onChange={(event) => onDraft({ ...draft, action_value: event.target.value })}
              data-customize-automation-value
              className={fieldTypeClass}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={draft.action_value}
              onChange={(event) => onDraft({ ...draft, action_value: event.target.value })}
              data-customize-automation-value
              placeholder="コメント本文"
              className={fieldTypeClass}
            />
          )}
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            キャンセル
          </button>
          <button type="submit" data-customize-automation-save disabled={busy} className={primaryButton}>
            保存
          </button>
        </div>
      </form>
    </CustomizeModal>
  );
}
