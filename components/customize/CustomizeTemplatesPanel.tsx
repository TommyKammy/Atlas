"use client";

import type { TaskTemplate } from "@/lib/data";

/** Task template list with edit/use/delete actions. */
export default function CustomizeTemplatesPanel({
  templates,
  sections,
  canEdit,
  canUse = canEdit,
  onAdd,
  onEdit,
  onUse,
  onDelete,
  secondaryButton,
}: {
  templates: TaskTemplate[];
  sections: { id: number; name: string }[];
  canEdit: boolean;
  canUse?: boolean;
  onAdd: (defaultSection: string) => void;
  onEdit: (template: TaskTemplate) => void;
  onUse: (template: TaskTemplate) => void;
  onDelete: (template: TaskTemplate) => void;
  secondaryButton: string;
}) {
  return (
    <div className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-text">タスクテンプレート</h3>
          <p className="mt-0.5 text-[12px] text-muted">繰り返し使うタスクをワンクリックで作成</p>
        </div>
        {canEdit && (
          <button
            type="button"
            data-customize-add-template
            onClick={() => onAdd(sections[0] ? String(sections[0].id) : "")}
            className={secondaryButton}
          >
            ＋ 追加
          </button>
        )}
      </div>
      <div className="mt-4 space-y-2">
        {templates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
            テンプレートがありません。よく使うタスクを登録しておくと便利です。
          </p>
        ) : (
          templates.map((template) => (
            <div key={template.id} className="rounded-lg border border-line px-4 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-text">{template.name}</div>
                  <div className="mt-0.5 truncate text-[12px] text-secondary">
                    タスク: {template.title_template}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                    <span>担当: {template.assignee_name ?? "なし"}</span>
                    <span>
                      期日: {template.due_offset_days === null ? "なし" : `今日 +${template.due_offset_days}日`}
                    </span>
                    <span>セクション: {template.section_name ?? "なし"}</span>
                    {template.subtasks.length > 0 && <span>サブタスク: {template.subtasks.length}件</span>}
                  </div>
                </div>
                {(canEdit || canUse) && (
                  <div className="flex shrink-0 items-center gap-1">
                    {canEdit && <button
                      type="button"
                      data-customize-template-edit={template.id}
                      aria-label={`${template.name}を編集`}
                      onClick={() => onEdit(template)}
                      className="flex h-7 w-7 items-center justify-center rounded text-subtle hover:bg-hover hover:text-secondary"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="m10.5 2.5 3 3L6 13H3v-3z" />
                      </svg>
                    </button>}
                    {canUse && <button
                      type="button"
                      data-customize-template-use={template.id}
                      onClick={() => onUse(template)}
                      className="h-7 rounded-md bg-accent-soft px-2 text-[12px] font-medium text-accent-text hover:bg-accent-soft-hover"
                    >
                      使用
                    </button>}
                    {canEdit && <button
                      type="button"
                      data-customize-template-delete={template.id}
                      aria-label={`${template.name}を削除`}
                      onClick={() => onDelete(template)}
                      className="flex h-7 w-7 items-center justify-center rounded text-subtle hover:bg-danger-soft hover:text-danger"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8h5.8l.6-8M6.5 7v3M9.5 7v3" />
                      </svg>
                    </button>}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
