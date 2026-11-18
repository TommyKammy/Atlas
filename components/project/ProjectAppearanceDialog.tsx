"use client";

import Dialog from "../ui/Dialog";
import ProjectIcon from "../ProjectIcon";
import { PROJECT_COLORS, PROJECT_ICONS, projectColor } from "@/lib/project-appearance";
import { PROJECT_DIALOG_PRIMARY } from "./RenameProjectDialog";

/** Project color/icon dialog used from the sidebar context menu. */
export default function ProjectAppearanceDialog({
  projectId,
  projectName,
  color,
  icon,
  onSave,
  onClose,
  onDone,
}: {
  projectId: number;
  projectName: string;
  color: string | null;
  icon: string | null;
  onSave: (patch: { color?: string | null; icon?: string | null }) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="カラーとアイコンを設定"
      backdropClassName="backdrop:bg-black/25"
      panelClassName="max-h-[90vh] w-[min(480px,90vw)] overflow-y-auto rounded-lg bg-surface text-sm shadow-xl"
    >
      <div data-project-appearance-dialog className="p-5">
        <h2 className="text-lg font-semibold">カラーとアイコンを設定</h2>
        <div className="mt-4 text-[13px] font-medium text-secondary">カラー</div>
        <div className="mt-2 grid grid-cols-8 gap-2">
          {PROJECT_COLORS.map((entry) => (
            <button
              key={entry.name}
              type="button"
              title={entry.name}
              onClick={() => onSave({ color: entry.value })}
              className={`flex h-6 w-6 items-center justify-center rounded-[5px] border border-black/10 text-xs text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.45)] ${
                color === entry.value ? "ring-2 ring-[#4075cf] ring-offset-1" : ""
              }`}
              style={{ backgroundColor: entry.value ?? "#d9d9d9" }}
            >
              {color === entry.value ? "✓" : ""}
            </button>
          ))}
        </div>
        <div className="mt-4 text-[13px] font-medium text-secondary">アイコン</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {PROJECT_ICONS.map((entry) => (
            <button
              key={entry.key ?? "none"}
              type="button"
              title={entry.label}
              onClick={() => onSave({ icon: entry.key })}
              className={`flex h-8 w-8 items-center justify-center rounded-md border text-[11px] ${
                icon === entry.key
                  ? "border-[#4075cf] bg-accent-soft text-accent-text"
                  : "text-muted hover:bg-neutral-50"
              }`}
            >
              {entry.key ? (
                <ProjectIcon
                  id={projectId}
                  name={projectName}
                  color={projectColor(projectId, color)}
                  icon={entry.key}
                  className="h-6 w-6 text-[9px]"
                />
              ) : (
                "なし"
              )}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-subtle">変更はすぐに保存されます。</p>
        <div className="mt-4 flex justify-end">
          <button type="button" className={PROJECT_DIALOG_PRIMARY} onClick={onDone}>
            完了
          </button>
        </div>
      </div>
    </Dialog>
  );
}
