"use client";

import type { FormEvent } from "react";
import type { Section, User } from "@/lib/data";
import CustomizeModal from "./CustomizeModal";

export type TemplateDraft = {
  id: number | null;
  name: string;
  title: string;
  assignee: string;
  offset: string;
  section: string;
  subtasks: string;
};

/** Add/edit task template modal. */
export default function CustomizeTemplateModal({
  draft,
  onDraft,
  onClose,
  onSubmit,
  users,
  sections,
  busy,
  fieldTypeClass,
  primaryButton,
  secondaryButton,
}: {
  draft: TemplateDraft;
  onDraft: (draft: TemplateDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  users: User[];
  sections: Section[];
  busy: boolean;
  fieldTypeClass: string;
  primaryButton: string;
  secondaryButton: string;
}) {
  return (
    <CustomizeModal title={draft.id === null ? "テンプレートを追加" : "テンプレートを編集"} onClose={onClose}>
      <form onSubmit={onSubmit} className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-[12px] font-medium text-secondary">
            テンプレート名
            <input
              data-customize-template-name
              value={draft.name}
              onChange={(event) => onDraft({ ...draft, name: event.target.value })}
              placeholder="週次レビュー"
              className={fieldTypeClass}
            />
          </label>
          <label className="block text-[12px] font-medium text-secondary">
            タスク名
            <input
              data-customize-template-title
              value={draft.title}
              onChange={(event) => onDraft({ ...draft, title: event.target.value })}
              placeholder="週次レビューを実施"
              className={fieldTypeClass}
            />
          </label>
          <label className="block text-[12px] font-medium text-secondary">
            担当者
            <select
              value={draft.assignee}
              onChange={(event) => onDraft({ ...draft, assignee: event.target.value })}
              className={fieldTypeClass}
            >
              <option value="">担当者なし</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-medium text-secondary">
            期日（今日からの日数）
            <input
              value={draft.offset}
              onChange={(event) => onDraft({ ...draft, offset: event.target.value })}
              inputMode="numeric"
              placeholder="3"
              className={fieldTypeClass}
            />
          </label>
          <label className="block text-[12px] font-medium text-secondary">
            セクション
            <select
              value={draft.section}
              onChange={(event) => onDraft({ ...draft, section: event.target.value })}
              className={fieldTypeClass}
            >
              <option value="">セクションなし</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-medium text-secondary sm:col-span-2">
            サブタスク
            <textarea
              value={draft.subtasks}
              onChange={(event) => onDraft({ ...draft, subtasks: event.target.value })}
              placeholder="資料を準備する, 関係者に共有する"
              rows={2}
              className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-[13px] outline-none focus:border-accent"
            />
            <span className="mt-1 block text-[11px] font-normal text-subtle">カンマまたは改行で区切ってください。</span>
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            キャンセル
          </button>
          <button type="submit" data-customize-template-save disabled={busy} className={primaryButton}>
            {draft.id === null ? "テンプレートを作成" : "保存"}
          </button>
        </div>
      </form>
    </CustomizeModal>
  );
}
