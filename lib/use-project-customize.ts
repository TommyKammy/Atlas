"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmAction } from "./ui-feedback";
import { api, ApiError } from "./api-client";
import { projectDrawerTop } from "./drawer-position";
import type { TaskTemplate } from "./data";
import type { CustomField } from "./custom-fields";
import { APP_CATALOG, type ProjectApp } from "./integrations";
import type { Bundle, BundleField } from "./bundles";
import type { ProjectRule } from "./automation/types";
import { canEditProject, canManageProject, type ProjectRole } from "./project-roles";
import type { FieldDraft } from "../components/customize/CustomizeFieldModal";
import type { TemplateDraft } from "../components/customize/CustomizeTemplateModal";
import { FIELD_LIBRARY } from "../components/customize/field-library";

export type CustomizePanel =
  | "home"
  | "appearance"
  | "status"
  | "fields"
  | "templates"
  | "email"
  | "apps"
  | "bundles"
  | "automations";

type StatusDraft = {
  key: number;
  original: string | null;
  value: string;
};

type StatusOptionsConflict = {
  status_options: string[];
  status_options_version: number;
  status_field_name: string;
  status_field_enabled: boolean;
};

async function fetchFields(projectId: number): Promise<CustomField[]> {
  const res = await fetch(`/api/custom-fields?project_id=${projectId}`);
  return res.ok ? res.json() : [];
}

async function fetchTemplates(projectId: number): Promise<TaskTemplate[]> {
  const res = await fetch(`/api/task-templates?project_id=${projectId}`);
  return res.ok ? res.json() : [];
}

/** Customize drawer state, loading and all project mutation handlers. */
export function useProjectCustomize({
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
}: {
  projectId: number;
  initialColor: string | null;
  initialIcon: string | null;
  initialStatusOptions: string[];
  initialStatusOptionsVersion: number;
  initialStatusFieldName: string;
  initialStatusFieldEnabled: boolean;
  initialFields: CustomField[];
  initialEmailAddress: string | null;
  initialEmailEnabled: boolean;
  initialBundles: Bundle[];
  initialRules: ProjectRule[];
  role: ProjectRole;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [panelTop, setPanelTop] = useState(0);
  const [panel, setPanel] = useState<CustomizePanel>("home");
  const [color, setColor] = useState<string | null>(initialColor);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [statusFieldName, setStatusFieldName] = useState(initialStatusFieldName);
  const [statusFieldEnabled, setStatusFieldEnabled] = useState(initialStatusFieldEnabled);
  const [statusOptionsVersion, setStatusOptionsVersion] = useState(initialStatusOptionsVersion);
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
    ruleIds: number[];
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
      const detail = (event as CustomEvent<{ panel?: CustomizePanel }>).detail;
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
      const saved = await api<{ status_options_version: number }>(`/api/projects/${projectId}`, "PATCH", {
        status_field_name: name,
        status_field_enabled: true,
        status_options: options,
        status_renames: renames,
        expected_status_options_version: statusOptionsVersion,
      });
      setStatusOptionsVersion(saved.status_options_version);
      setStatusFieldName(name);
      setStatusFieldEnabled(true);
      setStatusDrafts((current) =>
        current
          .filter((draft) => draft.value.trim() !== "")
          .map((draft) => ({ ...draft, original: draft.value.trim(), value: draft.value.trim() })),
      );
      router.refresh();
      notify("ステータスフィールドを更新しました");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = error.body as StatusOptionsConflict;
        setStatusOptionsVersion(current.status_options_version);
        setStatusFieldName(current.status_field_name);
        setStatusFieldEnabled(current.status_field_enabled);
        setStatusDrafts(current.status_options.map((option, index) => ({ key: index, original: option, value: option })));
        statusKey.current = current.status_options.length;
        router.refresh();
        notify("別の操作でステータスが更新されました。最新の選択肢を確認してから編集してください");
      } else {
        notify("ステータスの更新に失敗しました");
      }
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
        rules: initialRules
          .filter((rule) => bundleDraft.ruleIds.includes(rule.id))
          .map((rule) => ({
            name: rule.name,
            description: rule.description,
            definition: rule.definition,
            enabled: rule.enabled,
          })),
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

  const toggleDrawer = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setPanelTop(projectDrawerTop());
    setPanel("home");
    setOpen(true);
  };

  return {
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
  };
}

export type ProjectCustomizeState = ReturnType<typeof useProjectCustomize>;
