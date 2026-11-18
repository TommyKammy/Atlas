"use client";

import ProjectIcon from "../ProjectIcon";
import { PROJECT_COLORS, PROJECT_ICONS, projectColor, type ProjectIconKey } from "@/lib/project-appearance";

/** Appearance panel: project color and icon picker. */
export default function CustomizeAppearancePanel({
  projectId,
  projectName,
  color,
  icon,
  canAdmin,
  busy,
  onSave,
}: {
  projectId: number;
  projectName: string;
  color: string | null;
  icon: string | null;
  canAdmin: boolean;
  busy: boolean;
  onSave: (patch: { color?: string | null; icon?: string | null }) => void;
}) {
  return (
    <div className="p-5">
      <p className="text-[13px] text-secondary">
        プロジェクトのカラーとアイコンを変更します。変更はすぐに保存されます。
      </p>
      {!canAdmin && (
        <p className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">
          色とアイコンの変更はプロジェクト管理者のみ可能です。
        </p>
      )}
      <div className="mt-5 text-[12px] font-semibold text-secondary">カラー</div>
      <div className="mt-2 grid grid-cols-8 gap-2">
        {PROJECT_COLORS.map((entry) => (
          <button
            key={entry.name}
            type="button"
            title={entry.name}
            disabled={!canAdmin || busy}
            onClick={() => onSave({ color: entry.value })}
            className={`flex h-6 w-6 items-center justify-center rounded-[5px] border border-black/10 text-xs text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.45)] disabled:cursor-not-allowed disabled:opacity-50 ${
              color === entry.value ? "ring-2 ring-[#2c60b8] ring-offset-1" : ""
            }`}
            style={{ backgroundColor: entry.value ?? "#d9d9d9" }}
          >
            {color === entry.value ? "✓" : ""}
          </button>
        ))}
      </div>
      <div className="mt-5 text-[12px] font-semibold text-secondary">アイコン</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {PROJECT_ICONS.map((entry) => (
          <button
            key={entry.key ?? "none"}
            type="button"
            title={entry.label}
            disabled={!canAdmin || busy}
            onClick={() => onSave({ icon: entry.key })}
            className={`flex h-9 w-9 items-center justify-center rounded-md border text-[10px] disabled:cursor-not-allowed disabled:opacity-50 ${
              icon === entry.key
                ? "border-accent bg-accent-soft text-accent-text"
                : "border-line text-muted hover:bg-neutral-50"
            }`}
          >
            {entry.key ? (
              <ProjectIcon
                id={projectId}
                name={projectName}
                color={projectColor(projectId, color)}
                icon={entry.key as ProjectIconKey}
                className="h-7 w-7 text-[9px]"
              />
            ) : (
              "なし"
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
