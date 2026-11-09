"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { api } from "@/lib/api-client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { projectDrawerTop } from "@/lib/drawer-position";
import type { Section, TaskTemplate, User } from "@/lib/data";
import type { CustomField } from "@/lib/custom-fields";
import { APP_CATALOG, type ProjectApp } from "@/lib/integrations";
import type { Bundle, BundleField } from "@/lib/bundles";
import type { ProjectRule } from "@/lib/automation/types";
import { canEditProject, canManageProject, type ProjectRole } from "@/lib/project-roles";
import CustomizeHomePanel from "./customize/CustomizeHomePanel";
import CustomizeAppearancePanel from "./customize/CustomizeAppearancePanel";
import CustomizeStatusPanel from "./customize/CustomizeStatusPanel";
import CustomizeEmailPanel from "./customize/CustomizeEmailPanel";
import CustomizeAppsPanel from "./customize/CustomizeAppsPanel";
import CustomizeBundlesPanel from "./customize/CustomizeBundlesPanel";
import AutomationRulesPanel from "./customize/AutomationRulesPanel";
import CustomizeFieldsPanel from "./customize/CustomizeFieldsPanel";
import CustomizeTemplatesPanel from "./customize/CustomizeTemplatesPanel";
import CustomizeFieldModal, { type FieldDraft } from "./customize/CustomizeFieldModal";
import CustomizeTemplateModal, { type TemplateDraft } from "./customize/CustomizeTemplateModal";
import CustomizeBundleModal from "./customize/CustomizeBundleModal";
import CustomizeAppModal from "./customize/CustomizeAppModal";
import { FIELD_LIBRARY } from "./customize/field-library";
import { PaletteIcon } from "./customize/icons";
import Toast from "./ui/Toast";

type Panel = "home" | "appearance" | "status" | "fields" | "templates" | "email" | "apps" | "bundles" | "automations";



type StatusDraft = {
  key: number;
  original: string | null;
  value: string;
};

async function fetchFields(projectId: number): Promise<CustomField[]> {
  const res = await fetch(`/api/custom-fields?project_id=${projectId}`);
  return res.ok ? res.json() : [];
}

async function fetchTemplates(projectId: number): Promise<TaskTemplate[]> {
  const res = await fetch(`/api/task-templates?project_id=${projectId}`);
  return res.ok ? res.json() : [];
}

export default function ProjectCustomizeButton({
  projectId,
  projectName,
  initialColor,
  initialIcon,
  initialStatusOptions,
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
}: {
  projectId: number;
  projectName: string;
  initialColor: string | null;
  initialIcon: string | null;
  initialStatusOptions: string[];
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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [panelTop, setPanelTop] = useState(0);
  const [panel, setPanel] = useState<Panel>("home");
  const [color, setColor] = useState<string | null>(initialColor);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [statusFieldName, setStatusFieldName] = useState(initialStatusFieldName);
  const [statusFieldEnabled, setStatusFieldEnabled] = useState(initialStatusFieldEnabled);
  const [statusDrafts, setStatusDrafts] = useState<StatusDraft[]>(() =>
    initialStatusOptions.map((option, index) => ({ key: index, original: option, value: option })),
  );
  const statusKey = useRef(initialStatusOptions.length);
  const [fields, setFields] = useState<CustomField[]>(initialFields);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const [emailAddress, setEmailAddress] = useState(initialEmailAddress ?? "");
  const [emailEnabled, setEmailEnabled] = useState(initialEmailEnabled);
  const [emailCopied, setEmailCopied] = useState(false);
  const [appDraft, setAppDraft] = useState<{ app_key: string; config: Record<string, string> } | null>(null);
  const [bundleDraft, setBundleDraft] = useState<{
    name: string;
    description: string;
    fields: BundleField[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

  const canEdit = canEditProject(role);
  const canAdmin = canManageProject(role);
  const statusValues = statusDrafts.map((draft) => draft.value.trim()).filter(Boolean);

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2400);
  };

  useEffect(() => {
    if (!open) return;
    const onResize = () => setPanelTop(projectDrawerTop());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [nextFields, nextTemplates, emailRes] = await Promise.all([
        fetchFields(projectId),
        fetchTemplates(projectId),
        fetch(`/api/projects/${projectId}/email`),
      ]);
      if (!cancelled) {
        setFields(nextFields);
        setTemplates(nextTemplates);
        if (emailRes.ok) {
          const email = (await emailRes.json()) as { address?: string; enabled?: boolean };
          if (email.address) setEmailAddress(email.address);
          setEmailEnabled(email.enabled !== false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (fieldDraft) {
        setFieldDraft(null);
        return;
      }
      if (templateDraft) {
        setTemplateDraft(null);
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, fieldDraft, templateDraft]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [panel]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ panel?: Panel }>).detail;
      setPanelTop(projectDrawerTop());
      setPanel(detail?.panel === "status" || detail?.panel === "fields" ? detail.panel : "home");
      setOpen(true);
    };
    window.addEventListener("atlas:open-customize", onOpen);
    return () => window.removeEventListener("atlas:open-customize", onOpen);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const saveAppearance = async (patch: { color?: string | null; icon?: string | null }) => {
    if (!canAdmin || busy) return;
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}`, "PATCH", patch);
      if ("color" in patch) setColor(patch.color ?? null);
      if ("icon" in patch) setIcon(patch.icon ?? null);
      router.refresh();
      notify("カラーとアイコンを更新しました");
    } catch {
      notify("外観の更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const saveStatusOptions = async () => {
    if (!canAdmin || busy) return;
    const name = statusFieldName.trim() || "Status";
    const options = statusValues;
    if (options.length === 0) {
      notify("ステータスを1つ以上入力してください");
      return;
    }
    const renames = statusDrafts
      .filter((draft) => draft.original !== null && draft.value.trim() !== "" && draft.original !== draft.value.trim())
      .map((draft) => ({ from: draft.original!, to: draft.value.trim() }));
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}`, "PATCH", {
        status_field_name: name,
        status_field_enabled: true,
        status_options: options,
        status_renames: renames,
      });
      setStatusFieldName(name);
      setStatusFieldEnabled(true);
      setStatusDrafts((current) =>
        current
          .filter((draft) => draft.value.trim() !== "")
          .map((draft) => ({ ...draft, original: draft.value.trim(), value: draft.value.trim() })),
      );
      router.refresh();
      notify("ステータスフィールドを更新しました");
    } catch {
      notify("ステータスの更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const deleteStatusField = async () => {
    if (!canAdmin) return;
    if (!await confirmAction(`「${statusFieldName}」フィールドを削除しますか？タスクの値は保持されます。`)) return;
    try {
      await api(`/api/projects/${projectId}`, "PATCH", { status_field_enabled: false });
      setStatusFieldEnabled(false);
      setPanel("fields");
      router.refresh();
      notify("ステータスフィールドを削除しました");
    } catch {
      notify("ステータスフィールドの削除に失敗しました");
    }
  };

  const restoreStatusField = async () => {
    if (!canAdmin) return;
    try {
      await api(`/api/projects/${projectId}`, "PATCH", { status_field_enabled: true });
      setStatusFieldEnabled(true);
      router.refresh();
      notify("ステータスフィールドを追加しました");
    } catch {
      notify("ステータスフィールドの追加に失敗しました");
    }
  };

  const saveField = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!fieldDraft || !canEdit) return;
    const name = fieldDraft.name.trim();
    if (!name) {
      notify("フィールド名を入力してください");
      return;
    }
    const options =
      fieldDraft.field_type === "select" || fieldDraft.field_type === "multi_select"
        ? fieldDraft.options.split(/[,\n]/).map((o) => o.trim()).filter(Boolean)
        : [];
    setBusy(true);
    try {
      if (fieldDraft.id === null) {
        await api("/api/custom-fields", "POST", {
          project_id: projectId,
          name,
          field_type: fieldDraft.field_type,
          options,
        });
        notify("フィールドを追加しました");
      } else {
        await api(`/api/custom-fields/${fieldDraft.id}`, "PATCH", { name, options });
        notify("フィールドを更新しました");
      }
      setFields(await fetchFields(projectId));
      setFieldDraft(null);
      router.refresh();
    } catch {
      notify("フィールドの保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const removeField = async (field: CustomField) => {
    if (!canEdit) return;
    if (!await confirmAction(`フィールド「${field.name}」を削除しますか？（削除済みフィールドから復元できます）`)) return;
    try {
      await api(`/api/custom-fields/${field.id}`, "DELETE");
      setFields(await fetchFields(projectId));
      router.refresh();
      notify("フィールドを削除しました");
    } catch {
      notify("フィールドの削除に失敗しました");
    }
  };

  const addLibraryField = async (preset: (typeof FIELD_LIBRARY)[number]) => {
    if (!canEdit || busy) return;
    if (fields.some((field) => field.name === preset.name)) {
      notify("このフィールドはすでに追加されています");
      return;
    }
    setBusy(true);
    try {
      await api("/api/custom-fields", "POST", {
        project_id: projectId,
        name: preset.name,
        field_type: preset.field_type,
        options: preset.options,
      });
      setFields(await fetchFields(projectId));
      router.refresh();
      notify(`「${preset.name}」を追加しました`);
    } catch {
      notify("フィールドの追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!templateDraft || !canEdit) return;
    if (!templateDraft.name.trim() || !templateDraft.title.trim()) {
      notify("テンプレート名とタスク名を入力してください");
      return;
    }
    setBusy(true);
    const payload = {
      name: templateDraft.name.trim(),
      title_template: templateDraft.title.trim(),
      assignee_id: templateDraft.assignee === "" ? null : Number(templateDraft.assignee),
      due_offset_days: templateDraft.offset === "" ? null : Number(templateDraft.offset),
      section_id: templateDraft.section === "" ? null : Number(templateDraft.section),
      subtasks: templateDraft.subtasks
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
    };
    try {
      if (templateDraft.id === null) {
        await api("/api/task-templates", "POST", { project_id: projectId, ...payload });
        notify("テンプレートを追加しました");
      } else {
        await api(`/api/task-templates/${templateDraft.id}`, "PATCH", payload);
        notify("テンプレートを更新しました");
      }
      setTemplates(await fetchTemplates(projectId));
      setTemplateDraft(null);
    } catch {
      notify("テンプレートの保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const instantiateTemplate = async (template: TaskTemplate) => {
    if (!canEdit) return;
    try {
      await api(`/api/task-templates/${template.id}`, "POST", {});
      router.refresh();
      notify(`「${template.name}」からタスクを作成しました`);
    } catch {
      notify("タスクの作成に失敗しました");
    }
  };

  const removeTemplate = async (template: TaskTemplate) => {
    if (!canEdit) return;
    if (!await confirmAction(`テンプレート「${template.name}」を削除しますか？`)) return;
    try {
      await api(`/api/task-templates/${template.id}`, "DELETE");
      setTemplates(await fetchTemplates(projectId));
      notify("テンプレートを削除しました");
    } catch {
      notify("テンプレートの削除に失敗しました");
    }
  };

  const applyBundle = async (bundle: Bundle) => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const result = await api<{ created_fields: number }>(`/api/bundles/${bundle.id}/apply`, "POST", { project_id: projectId });
      router.refresh();
      notify(
        result.created_fields > 0
          ? `バンドルを適用し、${result.created_fields}件のフィールドを追加しました`
          : "バンドルは適用済みです",
      );
    } catch {
      notify("バンドルの適用に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const saveBundle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bundleDraft || !canAdmin) return;
    if (!bundleDraft.name.trim() || bundleDraft.fields.some((field) => !field.name.trim())) {
      notify("バンドル名とフィールド名を入力してください");
      return;
    }
    setBusy(true);
    try {
      await api("/api/bundles", "POST", {
        workspace_id: initialBundles[0]?.workspace_id ?? 1,
        name: bundleDraft.name.trim(),
        description: bundleDraft.description.trim(),
        fields: bundleDraft.fields,
      });
      setBundleDraft(null);
      router.refresh();
      notify("バンドルを作成しました");
    } catch {
      notify("バンドルの作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const removeBundle = async (bundle: Bundle) => {
    if (!canAdmin || !await confirmAction(`「${bundle.name}」バンドルを削除しますか？`)) return;
    try {
      await api(`/api/bundles/${bundle.id}`, "DELETE");
      router.refresh();
      notify("バンドルを削除しました");
    } catch {
      notify("バンドルの削除に失敗しました");
    }
  };

  const installApp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!appDraft || !canEdit) return;
    const definition = APP_CATALOG.find((app) => app.key === appDraft.app_key);
    if (!definition) return;
    const missing = definition.fields.find(
      (field) => field.required && !(appDraft.config[field.key] ?? "").trim(),
    );
    if (missing) {
      notify(`${missing.label}を入力してください`);
      return;
    }
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/apps`, "POST", appDraft);
      setAppDraft(null);
      router.refresh();
      notify("アプリを追加しました");
    } catch {
      notify("アプリの追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const toggleApp = async (app: ProjectApp) => {
    if (!canEdit) return;
    try {
      await api(`/api/projects/${projectId}/apps/${app.id}`, "PATCH", { enabled: !app.enabled });
      router.refresh();
    } catch {
      notify("アプリの更新に失敗しました");
    }
  };

  const removeApp = async (app: ProjectApp) => {
    if (!canEdit || !await confirmAction("このアプリ連携を削除しますか？")) return;
    try {
      await api(`/api/projects/${projectId}/apps/${app.id}`, "DELETE");
      router.refresh();
      notify("アプリを削除しました");
    } catch {
      notify("アプリの削除に失敗しました");
    }
  };

  const updateEmail = async (patch: { enabled?: boolean; regenerate?: boolean }) => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const next = await api<{ address?: string | null; enabled?: boolean }>(`/api/projects/${projectId}/email`, "PATCH", patch);
      setEmailAddress(next.address ?? emailAddress);
      setEmailEnabled(next.enabled !== false);
      notify(patch.regenerate ? "メールアドレスを再生成しました" : "メール設定を更新しました");
    } catch {
      notify("メール設定の更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const copyEmail = async () => {
    if (!emailAddress) return;
    try {
      await navigator.clipboard.writeText(emailAddress);
      setEmailCopied(true);
      window.setTimeout(() => setEmailCopied(false), 1600);
    } catch {
      notify("コピーに失敗しました");
    }
  };

  const panelTitle: Record<Panel, string> = {
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
    "mt-1 h-9 w-full rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]";
  const primaryButton =
    "flex h-8 items-center justify-center rounded-md bg-[#2c60b8] px-3 text-[13px] font-medium text-white hover:bg-[#24549f] disabled:opacity-50";
  const secondaryButton =
    "flex h-8 items-center justify-center rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";

  return (
    <>
      <button
        type="button"
        data-project-customize
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setPanelTop(projectDrawerTop());
          setPanel("home");
          setOpen(true);
        }}
        className={`hidden h-7 items-center gap-1 rounded-md border px-2.5 text-xs md:flex ${
          open
            ? "border-[#2c60b8] bg-[#eff4fd] text-[#2c60b8]"
            : "border-[#e1e1e1] bg-white text-neutral-700 hover:bg-neutral-50"
        }`}
      >
        <PaletteIcon />
        カスタマイズ
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
            className="project-drawer-enter project-drawer-enter-customize fixed right-0 z-[70] flex w-[min(480px,100vw)] flex-col border-l border-neutral-200 bg-white shadow-2xl"
          >
          <div className="flex h-[60px] shrink-0 items-center gap-2 border-b border-neutral-200 px-5">
            {panel !== "home" && (
              <button
                type="button"
                onClick={() => setPanel("home")}
                aria-label="戻る"
                className="mr-1 flex h-7 w-7 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M13 8H3m4-4L3 8l4 4" />
                </svg>
              </button>
            )}
            <h2 className="min-w-0 flex-1 truncate text-[18px] font-semibold text-neutral-900">{panelTitle[panel]}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="閉じる"
              className="flex h-7 w-7 items-center justify-center rounded-md text-xl leading-none text-neutral-500 hover:bg-neutral-100"
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
                canAdmin={canAdmin}
                busy={busy}
                onSave={(patch) => void saveAppearance(patch)}
              />
            )}

            {panel === "status" && (
              <CustomizeStatusPanel
                canAdmin={canAdmin}
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
                canEdit={canEdit}
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
                canEdit={canEdit}
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
                canEdit={canEdit}
                canAdmin={canAdmin}
                busy={busy}
                onAdd={() =>
                  setBundleDraft({
                    name: "",
                    description: "",
                    fields: [{ name: "優先度", field_type: "select", options: ["高", "中", "低"] }],
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
                canEdit={canEdit}
              />
            )}

            {panel === "fields" && (
              <CustomizeFieldsPanel
                fields={fields}
                statusFieldEnabled={statusFieldEnabled}
                statusFieldName={statusFieldName}
                statusValues={statusValues}
                canEdit={canEdit}
                canAdmin={canAdmin}
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
                templates={templates}
                sections={sections}
                canEdit={canEdit}
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
            className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md bg-neutral-800 px-3 py-1.5 text-[12px] text-white shadow-lg"
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
