"use client";

import { APP_CATALOG, type ProjectApp } from "@/lib/integrations";

/** Installed project apps list with add/toggle/remove actions. */
export default function CustomizeAppsPanel({
  apps,
  canEdit,
  onAdd,
  onToggle,
  onRemove,
  secondaryButton,
}: {
  apps: ProjectApp[];
  canEdit: boolean;
  onAdd: () => void;
  onToggle: (app: ProjectApp) => void;
  onRemove: (app: ProjectApp) => void;
  secondaryButton: string;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] text-neutral-600">
          プロジェクトで利用する外部アプリを管理します。連携設定はプロジェクト単位で保存されます。
        </p>
        {canEdit && (
          <button type="button" data-customize-app-add onClick={onAdd} className={secondaryButton}>
            ＋ アプリを追加
          </button>
        )}
      </div>
      <div className="mt-4 space-y-2">
        {apps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center text-[13px] text-neutral-500">
            連携中のアプリはありません。
          </div>
        ) : (
          apps.map((app) => {
            const definition = APP_CATALOG.find((entry) => entry.key === app.app_key);
            return (
              <div
                key={app.id}
                data-customize-app={app.app_key}
                className="rounded-lg border border-[#e1e1e1] bg-white px-4 py-3"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-neutral-900">
                        {definition?.name ?? app.app_key}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          app.enabled ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-500"
                        }`}
                      >
                        {app.enabled ? "有効" : "無効"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">{definition?.description}</div>
                    {Object.entries(app.config).length > 0 && (
                      <div className="mt-1 truncate text-[11px] text-neutral-400">
                        {Object.entries(app.config)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(" ・ ")}
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        data-customize-app-toggle={app.id}
                        onClick={() => onToggle(app)}
                        className="h-7 rounded-md border border-[#e1e1e1] px-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
                      >
                        {app.enabled ? "無効化" : "有効化"}
                      </button>
                      <button
                        type="button"
                        data-customize-app-remove={app.id}
                        aria-label={`${definition?.name ?? app.app_key}を削除`}
                        onClick={() => onRemove(app)}
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
