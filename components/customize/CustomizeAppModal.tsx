"use client";

import type { FormEvent } from "react";
import { APP_CATALOG, type ProjectApp } from "@/lib/integrations";
import CustomizeModal from "./CustomizeModal";

export type AppDraft = {
  app_key: string;
  config: Record<string, string>;
};

/** Install app modal. */
export default function CustomizeAppModal({
  draft,
  onDraft,
  onClose,
  onSubmit,
  installedApps,
  busy,
  fieldTypeClass,
  primaryButton,
  secondaryButton,
}: {
  draft: AppDraft;
  onDraft: (draft: AppDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  installedApps: ProjectApp[];
  busy: boolean;
  fieldTypeClass: string;
  primaryButton: string;
  secondaryButton: string;
}) {
  return (
    <CustomizeModal title="アプリを追加" onClose={onClose}>
      <form onSubmit={onSubmit} data-customize-app-form className="p-5">
        <label className="block text-[12px] font-medium text-neutral-700">
          アプリ
          <select
            value={draft.app_key}
            onChange={(event) => onDraft({ app_key: event.target.value, config: {} })}
            data-customize-app-select
            className={fieldTypeClass}
          >
            {APP_CATALOG.filter((app) => !installedApps.some((installed) => installed.app_key === app.key)).map(
              (app) => (
                <option key={app.key} value={app.key}>
                  {app.name}
                </option>
              ),
            )}
          </select>
        </label>
        {(() => {
          const definition = APP_CATALOG.find((app) => app.key === draft.app_key);
          if (!definition) return null;
          return (
            <>
              <p className="mt-2 text-[12px] text-muted">{definition.description}</p>
              {definition.fields.map((field) => (
                <label key={field.key} className="mt-3 block text-[12px] font-medium text-neutral-700">
                  {field.label}
                  {field.required && <span className="ml-1 text-red-500">*</span>}
                  <input
                    value={draft.config[field.key] ?? ""}
                    onChange={(event) =>
                      onDraft({
                        ...draft,
                        config: { ...draft.config, [field.key]: event.target.value },
                      })
                    }
                    data-customize-app-field={field.key}
                    placeholder={field.placeholder}
                    className={fieldTypeClass}
                  />
                </label>
              ))}
            </>
          );
        })()}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            キャンセル
          </button>
          <button type="submit" data-customize-app-save disabled={busy} className={primaryButton}>
            追加
          </button>
        </div>
      </form>
    </CustomizeModal>
  );
}
