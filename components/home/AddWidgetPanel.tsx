"use client";

import {
  HOME_WIDGET_META,
  HOME_WIDGET_TYPES,
  type HomeWidgetType,
} from "@/lib/home-widgets";

const ICONS: Record<HomeWidgetType, string> = {
  my_tasks: "✓",
  projects: "▦",
  assigned_tasks: "↗",
  members: "👥",
  portfolio: "▤",
  status_updates: "◉",
  forms: "📝",
  mentions: "@",
  comment_drafts: "✎",
  notepad: "🔒",
};

export default function AddWidgetPanel({
  open,
  existingTypes,
  onAdd,
  onClose,
}: {
  open: boolean;
  existingTypes: HomeWidgetType[];
  onAdd: (type: HomeWidgetType) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/15" onClick={onClose} />
      <aside
        data-home-add-widget
        className="fixed bottom-0 right-0 top-12 z-[101] flex w-[min(380px,94vw)] flex-col border-l border-line bg-surface shadow-2xl"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 className="text-[16px] font-semibold text-text">ウィジェットを追加</h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-[18px] text-muted hover:bg-neutral-100"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {HOME_WIDGET_TYPES.map((type) => {
            const meta = HOME_WIDGET_META[type];
            const added = existingTypes.includes(type);
            return (
              <div
                key={type}
                data-home-add-widget-type={type}
                className="rounded-lg border border-line p-3"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[16px] text-secondary">
                    {ICONS[type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-text">{meta.label}</h3>
                      <button
                        type="button"
                        disabled={added}
                        onClick={() => onAdd(type)}
                        className="ml-auto rounded px-2 py-0.5 text-[12px] text-[#2c60b8] hover:bg-[#eff4fd] disabled:text-neutral-300"
                      >
                        {added ? "追加済み" : "＋ 追加"}
                      </button>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-muted">{meta.description}</p>
                    <div className="mt-2 flex gap-1">
                      <span className="h-2 w-16 rounded-full bg-surface-muted" />
                      <span className="h-2 w-10 rounded-full bg-surface-muted" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
