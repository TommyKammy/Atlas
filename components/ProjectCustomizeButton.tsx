"use client";

import { confirmAction } from "@/lib/ui-feedback";

import type { Section, User } from "@/lib/data";
import type { CustomField } from "@/lib/custom-fields";
import { APP_CATALOG, type ProjectApp } from "@/lib/integrations";
import type { Bundle } from "@/lib/bundles";
import type { ProjectRule } from "@/lib/automation/types";
import type { ProjectRole } from "@/lib/project-roles";
import CustomizeHomePanel from "./customize/CustomizeHomePanel";
import CustomizeAppearancePanel from "./customize/CustomizeAppearancePanel";
import CustomizeStatusPanel from "./customize/CustomizeStatusPanel";
import CustomizeEmailPanel from "./customize/CustomizeEmailPanel";
import CustomizeAppsPanel from "./customize/CustomizeAppsPanel";
import CustomizeBundlesPanel from "./customize/CustomizeBundlesPanel";
import AutomationRulesPanel from "./customize/AutomationRulesPanel";
import CustomizeFieldsPanel from "./customize/CustomizeFieldsPanel";
import CustomizeTemplatesPanel from "./customize/CustomizeTemplatesPanel";
import CustomizeFieldModal from "./customize/CustomizeFieldModal";
import CustomizeTemplateModal from "./customize/CustomizeTemplateModal";
import CustomizeBundleModal from "./customize/CustomizeBundleModal";
import CustomizeAppModal from "./customize/CustomizeAppModal";
import { useProjectCustomize } from "@/lib/use-project-customize";
import { PaletteIcon } from "./customize/icons";
import Toast from "./ui/Toast";

export default function ProjectCustomizeButton({
  projectId,
  projectName,
  initialColor,
  initialIcon,
  initialStatusOptions,
  initialStatusOptionsVersion,
  initialStatusFieldName,
  initialStatusFieldEnabled,
  initialFields,
  initialEmailAddress,
  initialEmailEnabled,
  initialApps,
  initialBundles,
  initialRules,
  sections,
  users,
  role,
  projectSettings,
}: {
  projectId: number;
  projectName: string;
  initialColor: string | null;
  initialIcon: string | null;
  initialStatusOptions: string[];
  initialStatusOptionsVersion: number;
  initialStatusFieldName: string;
  initialStatusFieldEnabled: boolean;
  initialFields: CustomField[];
  initialEmailAddress: string | null;
  initialEmailEnabled: boolean;
  initialApps: ProjectApp[];
  initialBundles: Bundle[];
  initialRules: ProjectRule[];
  sections: Section[];
  users: User[];
  role: ProjectRole;
  projectSettings?: unknown;
}) {
  const {
    open,
    setOpen,
    panelTop,
    panel,
    setPanel,
    color,
    icon,
    statusFieldName,
    setStatusFieldName,
    statusFieldEnabled,
    statusDrafts,
    setStatusDrafts,
    statusKey,
    fields,
    templates,
    fieldDraft,
    setFieldDraft,
    templateDraft,
    setTemplateDraft,
    emailAddress,
    emailEnabled,
    emailCopied,
    appDraft,
    setAppDraft,
    bundleDraft,
    setBundleDraft,
    busy,
    toast,
    scrollRef,
    canEdit,
    canConfigure,
    canAdmin,
    statusValues,
    notify,
    saveAppearance,
    saveStatusOptions,
    deleteStatusField,
    restoreStatusField,
    saveField,
    removeField,
    addLibraryField,
    saveTemplate,
    instantiateTemplate,
    removeTemplate,
    applyBundle,
    saveBundle,
    removeBundle,
    installApp,
    toggleApp,
    removeApp,
    updateEmail,
    copyEmail,
    toggleDrawer,
  } = useProjectCustomize({
    projectId,
    initialColor,
    initialIcon,
    initialStatusOptions,
    initialStatusOptionsVersion,
    initialStatusFieldName,
    initialStatusFieldEnabled,
    initialFields,
    initialEmailAddress,
    initialEmailEnabled,
    initialBundles,
    initialRules,
    role,
    projectSettings,
  });

  const panelTitle: Record<"home" | "appearance" | "status" | "fields" | "templates" | "email" | "apps" | "bundles" | "automations", string> = {
    home: "カスタマイズ",
    appearance: "カラーとアイコン",
    status: statusFieldName || "ステータス",
    fields: "フィールド",
    templates: "タスクタイプとテンプレート",
    email: "メールアドレス",
    apps: "アプリ",
    bundles: "バンドル",
    automations: "AIと自動化",
  };

  const fieldTypeClass =
    "mt-1 h-9 w-full rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent";
  const primaryButton =
    "flex h-8 items-center justify-center rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50";
  const secondaryButton =
    "flex h-8 items-center justify-center rounded-md border border-line bg-surface px-3 text-[13px] text-secondary hover:bg-hover disabled:opacity-50";

  return (
    <>
      <button
        type="button"
        data-project-customize
        aria-label="カスタマイズ"
        aria-expanded={open}
        title="カスタマイズ"
        onClick={toggleDrawer}
        className={`hidden h-7 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs whitespace-nowrap md:flex md:@max-[700px]:w-7 md:@max-[700px]:justify-center md:@max-[700px]:gap-0 md:@max-[700px]:px-0 ${
          open
            ? "border-accent bg-accent-soft text-accent-text"
            : "border-line bg-surface text-secondary hover:bg-hover"
        }`}
      >
        <PaletteIcon />
        <span className="hidden md:@min-[1000px]:inline">カスタマイズ</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="カスタマイズを閉じる"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[65] cursor-default bg-transparent"
          />
          <aside
            data-project-customize-drawer
            role="dialog"
            aria-modal="true"
            aria-label="プロジェクトをカスタマイズ"
            style={{ top: panelTop, height: `calc(100vh - ${panelTop}px)` }}
            className="project-drawer-enter project-drawer-enter-customize fixed right-0 z-[70] flex w-[min(480px,100vw)] flex-col border-l border-line bg-surface shadow-2xl"
          >
          <div className="flex h-[60px] shrink-0 items-center gap-2 border-b border-line px-5">
            {panel !== "home" && (
              <button
                type="button"
                onClick={() => setPanel("home")}
                aria-label="戻る"
                className="mr-1 flex h-7 w-7 items-center justify-center rounded-md text-secondary hover:bg-hover"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M13 8H3m4-4L3 8l4 4" />
                </svg>
              </button>
            )}
            <h2 className="min-w-0 flex-1 truncate text-[18px] font-semibold text-text">{panelTitle[panel]}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="閉じる"
              className="flex h-7 w-7 items-center justify-center rounded-md text-xl leading-none text-muted hover:bg-hover"
            >
              ×
            </button>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-customize-panel={panel}>
            {panel === "home" && (
              <CustomizeHomePanel
                projectId={projectId}
                projectName={projectName}
                color={color}
                icon={icon}
                statusFieldEnabled={statusFieldEnabled}
                statusFieldName={statusFieldName}
                statusValues={statusValues}
                fieldCount={fields.length}
                templateCount={templates.length}
                appCount={initialApps.length}
                bundleCount={initialBundles.filter((bundle) => bundle.applied).length}
                automationCount={initialRules.filter((rule) => rule.enabled).length}
                onOpen={(next) => setPanel(next)}
              />
            )}

            {panel === "appearance" && (
              <CustomizeAppearancePanel
                projectId={projectId}
                projectName={projectName}
                color={color}
                icon={icon}
                canAdmin={canConfigure}
                busy={busy}
                onSave={(patch) => void saveAppearance(patch)}
              />
            )}

            {panel === "status" && (
              <CustomizeStatusPanel
                canAdmin={canConfigure}
                statusFieldName={statusFieldName}
                onStatusFieldName={setStatusFieldName}
                drafts={statusDrafts}
                onChangeDraft={(key, value) =>
                  setStatusDrafts((current) =>
                    current.map((entry) => (entry.key === key ? { ...entry, value } : entry)),
                  )
                }
                onRemoveDraft={(key) => setStatusDrafts((current) => current.filter((entry) => entry.key !== key))}
                onAddDraft={() =>
                  setStatusDrafts((current) => [
                    ...current,
                    { key: statusKey.current++, original: null, value: "新しいステータス" },
                  ])
                }
                onDelete={() => void deleteStatusField()}
                onSave={() => void saveStatusOptions()}
                busy={busy}
                primaryButton={primaryButton}
              />
            )}

            {panel === "email" && (
              <CustomizeEmailPanel
                address={emailAddress}
                copied={emailCopied}
                enabled={emailEnabled}
                canEdit={canConfigure}
                busy={busy}
                onCopy={() => void copyEmail()}
                onToggle={(enabled) => void updateEmail({ enabled })}
                onRegenerate={async () => {
                  if (await confirmAction("メールアドレスを再生成しますか？以前のアドレスは使えなくなります。")) {
                    void updateEmail({ regenerate: true });
                  }
                }}
                secondaryButton={secondaryButton}
              />
            )}

            {panel === "apps" && (
              <CustomizeAppsPanel
                apps={initialApps}
                canEdit={canConfigure}
                onAdd={() => {
                  const available = APP_CATALOG.find(
                    (app) => !initialApps.some((installed) => installed.app_key === app.key),
                  );
                  if (!available) {
                    notify("追加できるアプリがありません");
                    return;
                  }
                  setAppDraft({ app_key: available.key, config: {} });
                }}
                onToggle={(app) => void toggleApp(app)}
                onRemove={(app) => void removeApp(app)}
                secondaryButton={secondaryButton}
              />
            )}

            {panel === "bundles" && (
              <CustomizeBundlesPanel
                bundles={initialBundles}
                canEdit={canConfigure}
                canAdmin={canAdmin}
                busy={busy}
                onAdd={() =>
                  setBundleDraft({
                    name: "",
                    description: "",
                    fields: [{ name: "優先度", field_type: "select", options: ["高", "中", "低"] }],
                    ruleIds: [],
                  })
                }
                onApply={(bundle) => void applyBundle(bundle)}
                onRemove={(bundle) => void removeBundle(bundle)}
                secondaryButton={secondaryButton}
              />
            )}

            {panel === "automations" && (
              <AutomationRulesPanel
                projectId={projectId}
                initialRules={initialRules}
                canEdit={canConfigure}
              />
            )}

            {panel === "fields" && (
              <CustomizeFieldsPanel
                fields={fields}
                statusFieldEnabled={statusFieldEnabled}
                statusFieldName={statusFieldName}
                statusValues={statusValues}
                canEdit={canConfigure}
                canAdmin={canConfigure}
                busy={busy}
                onAdd={() => setFieldDraft({ id: null, name: "", field_type: "text", options: "" })}
                onEditField={(field) =>
                  setFieldDraft({
                    id: field.id,
                    name: field.name,
                    field_type: field.field_type,
                    options: field.options.join(", "),
                  })
                }
                onRemoveField={(field) => void removeField(field)}
                onEditStatus={() => setPanel("status")}
                onDeleteStatus={() => void deleteStatusField()}
                onRestoreStatus={() => void restoreStatusField()}
                onAddLibraryField={(preset) => void addLibraryField(preset)}
                secondaryButton={secondaryButton}
              />
            )}

            {panel === "templates" && (
              <CustomizeTemplatesPanel
                canUse={canEdit}
                templates={templates}
                sections={sections}
                canEdit={canConfigure}
                onAdd={(defaultSection) =>
                  setTemplateDraft({
                    id: null,
                    name: "",
                    title: "",
                    assignee: "",
                    offset: "",
                    section: defaultSection,
                    subtasks: "",
                  })
                }
                onEdit={(template) =>
                  setTemplateDraft({
                    id: template.id,
                    name: template.name,
                    title: template.title_template,
                    assignee: template.assignee_id === null ? "" : String(template.assignee_id),
                    offset: template.due_offset_days === null ? "" : String(template.due_offset_days),
                    section: template.section_id === null ? "" : String(template.section_id),
                    subtasks: template.subtasks.map((s) => s.name).join(", "),
                  })
                }
                onUse={(template) => void instantiateTemplate(template)}
                onDelete={(template) => void removeTemplate(template)}
                secondaryButton={secondaryButton}
              />
            )}
          </div>

          <Toast
            message={toast}
            className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md bg-inverse-surface px-3 py-1.5 text-[12px] text-on-strong shadow-lg"
          />
          </aside>
        </>
      )}

      {fieldDraft && (
        <CustomizeFieldModal
          draft={fieldDraft}
          onDraft={setFieldDraft}
          onClose={() => setFieldDraft(null)}
          onSubmit={saveField}
          busy={busy}
          fieldTypeClass={fieldTypeClass}
          primaryButton={primaryButton}
          secondaryButton={secondaryButton}
        />
      )}

      {templateDraft && (
        <CustomizeTemplateModal
          draft={templateDraft}
          onDraft={setTemplateDraft}
          onClose={() => setTemplateDraft(null)}
          onSubmit={saveTemplate}
          users={users}
          sections={sections}
          busy={busy}
          fieldTypeClass={fieldTypeClass}
          primaryButton={primaryButton}
          secondaryButton={secondaryButton}
        />
      )}

      {bundleDraft && (
        <CustomizeBundleModal
          draft={bundleDraft}
          onDraft={setBundleDraft}
          onClose={() => setBundleDraft(null)}
          onSubmit={saveBundle}
          availableRules={initialRules}
          busy={busy}
          fieldTypeClass={fieldTypeClass}
          primaryButton={primaryButton}
          secondaryButton={secondaryButton}
        />
      )}

      {appDraft && (
        <CustomizeAppModal
          draft={appDraft}
          onDraft={setAppDraft}
          onClose={() => setAppDraft(null)}
          onSubmit={installApp}
          installedApps={initialApps}
          busy={busy}
          fieldTypeClass={fieldTypeClass}
          primaryButton={primaryButton}
          secondaryButton={secondaryButton}
        />
      )}
    </>
  );
}
