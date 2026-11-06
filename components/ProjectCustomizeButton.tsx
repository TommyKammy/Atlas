"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Section, TaskTemplate, User } from "@/lib/data";
import type { CustomField } from "@/lib/custom-fields";
import { APP_CATALOG, type ProjectApp } from "@/lib/integrations";
import type { Bundle, BundleField } from "@/lib/bundles";
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  type AutomationAction,
  type AutomationTrigger,
  type ProjectAutomation,
} from "@/lib/automations";
import { PROJECT_COLORS, PROJECT_ICONS, projectColor, type ProjectIconKey } from "@/lib/project-appearance";
import { canEditProject, canManageProject, type ProjectRole } from "@/lib/project-roles";
import ProjectIcon from "./ProjectIcon";
import { useFocusTrap } from "@/lib/use-focus-trap";

type Panel = "home" | "appearance" | "status" | "fields" | "templates" | "email" | "apps" | "bundles" | "automations";

type FieldDraft = {
  id: number | null;
  name: string;
  field_type: CustomField["field_type"];
  options: string;
};

type TemplateDraft = {
  id: number | null;
  name: string;
  title: string;
  assignee: string;
  offset: string;
  section: string;
  subtasks: string;
};

type StatusDraft = {
  key: number;
  original: string | null;
  value: string;
};

const FIELD_TYPE_LABELS: Record<CustomField["field_type"], string> = {
  text: "テキスト",
  number: "数値",
  select: "単一選択",
};

const FIELD_TYPE_ICONS: Record<CustomField["field_type"], string> = {
  text: "T",
  number: "123",
  select: "○",
};

const FIELD_LIBRARY: Array<{
  name: string;
  description: string;
  field_type: CustomField["field_type"];
  options: string[];
}> = [
  { name: "優先度", description: "高 / 中 / 低", field_type: "select", options: ["高", "中", "低"] },
  { name: "承認状況", description: "承認待ち / 承認済み / 差し戻し", field_type: "select", options: ["承認待ち", "承認済み", "差し戻し"] },
  { name: "作業量", description: "数値で見積もりを入力", field_type: "number", options: [] },
  { name: "見積時間", description: "時間単位の数値", field_type: "number", options: [] },
  { name: "メモ", description: "補足情報を自由記述", field_type: "text", options: [] },
  { name: "部署", description: "担当部署をテキストで入力", field_type: "text", options: [] },
];

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.json();
}

async function fetchFields(projectId: number): Promise<CustomField[]> {
  const res = await fetch(`/api/custom-fields?project_id=${projectId}`);
  return res.ok ? res.json() : [];
}

async function fetchTemplates(projectId: number): Promise<TaskTemplate[]> {
  const res = await fetch(`/api/task-templates?project_id=${projectId}`);
  return res.ok ? res.json() : [];
}

function PaletteIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10 2.5a7.5 7.5 0 1 0 0 15h1.1a1.7 1.7 0 0 0 1.1-3l-.2-.2a1.4 1.4 0 0 1 1-2.4h1.2A2.3 2.3 0 0 0 17.5 9.6 7.2 7.2 0 0 0 10 2.5Z" />
      <circle cx="6.1" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="8.7" cy="5.4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="12.3" cy="5.7" r=".9" fill="currentColor" stroke="none" />
      <circle cx="6" cy="11.6" r=".9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function StatusGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.3v4l2.4 1.4" />
    </svg>
  );
}

function FieldGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 5.5h12M4 10h12M4 14.5h12" />
    </svg>
  );
}

function TemplateGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}

function MailGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="4.5" width="14" height="11" rx="1.5" />
      <path d="m3.5 6 6.5 5 6.5-5" />
    </svg>
  );
}

function AppsGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <rect x="12" y="12" width="5" height="5" rx="1" />
    </svg>
  );
}

function BundleGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="m10 2.5 7 3.5-7 3.5-7-3.5 7-3.5Z" />
      <path d="m3 10 7 3.5 7-3.5M3 14l7 3.5 7-3.5" />
    </svg>
  );
}

function AutomationGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M11 2 5 11h4l-1 7 7-9h-4l1-7Z" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
    </svg>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, onClose);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/25 p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-[min(560px,94vw)] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <h3 className="text-[17px] font-semibold text-neutral-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-7 w-7 items-center justify-center rounded-md text-xl leading-none text-neutral-500 hover:bg-neutral-100"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CustomizeRow({
  icon,
  title,
  description,
  count,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-customize-row={title}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-[#e1e1e1] bg-white px-4 py-3 text-left transition-colors hover:border-[#cfcfcf] hover:bg-neutral-50"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-neutral-900">{title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-neutral-500">{description}</span>
      </span>
      {count !== undefined && <span className="shrink-0 text-[12px] text-neutral-500">{count}</span>}
      <Chevron />
    </button>
  );
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
  initialAutomations,
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
  initialAutomations: ProjectAutomation[];
  sections: Section[];
  users: User[];
  role: ProjectRole;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
  const [automationDraft, setAutomationDraft] = useState<{
    name: string;
    trigger: AutomationTrigger;
    action_type: AutomationAction;
    action_value: string;
  } | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
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
      setPanel(detail?.panel === "status" ? "status" : "home");
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
    if (!window.confirm(`「${statusFieldName}」フィールドを削除しますか？タスクの値は保持されます。`)) return;
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
      fieldDraft.field_type === "select"
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
    if (!window.confirm(`フィールド「${field.name}」を削除しますか？`)) return;
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
    if (!window.confirm(`テンプレート「${template.name}」を削除しますか？`)) return;
    try {
      await api(`/api/task-templates/${template.id}`, "DELETE");
      setTemplates(await fetchTemplates(projectId));
      notify("テンプレートを削除しました");
    } catch {
      notify("テンプレートの削除に失敗しました");
    }
  };

  const saveAutomation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!automationDraft || !canEdit) return;
    if (!automationDraft.name.trim() || !automationDraft.action_value.trim()) {
      notify("ルール名とアクションの値を入力してください");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/automations`, "POST", automationDraft);
      setAutomationDraft(null);
      router.refresh();
      notify("自動化ルールを作成しました");
    } catch {
      notify("自動化ルールの作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const toggleAutomation = async (rule: ProjectAutomation) => {
    if (!canEdit) return;
    try {
      await api(`/api/projects/${projectId}/automations/${rule.id}`, "PATCH", {
        enabled: !rule.enabled,
      });
      router.refresh();
    } catch {
      notify("自動化ルールの更新に失敗しました");
    }
  };

  const removeAutomation = async (rule: ProjectAutomation) => {
    if (!canEdit || !window.confirm(`「${rule.name}」を削除しますか？`)) return;
    try {
      await api(`/api/projects/${projectId}/automations/${rule.id}`, "DELETE");
      router.refresh();
      notify("自動化ルールを削除しました");
    } catch {
      notify("自動化ルールの削除に失敗しました");
    }
  };

  const aiSuggest = () => {
    const prompt = aiPrompt.trim();
    if (prompt === "") {
      notify("作りたい自動化を入力してください");
      return;
    }
    if (prompt.includes("完了") && prompt.includes("コメント")) {
      setAutomationDraft({
        name: "完了時にコメント",
        trigger: "task_completed",
        action_type: "add_comment",
        action_value: "完了おめでとうございます！",
      });
    } else if (prompt.includes("担当")) {
      setAutomationDraft({
        name: "新規タスクに担当者を設定",
        trigger: "task_created",
        action_type: "set_assignee",
        action_value: String(users[0]?.id ?? ""),
      });
    } else {
      setAutomationDraft({
        name: prompt.includes("進行中") ? "新規タスクを進行中にする" : "新規タスクのStatusを設定",
        trigger: "task_created",
        action_type: "set_status",
        action_value: statusValues.find((value) => prompt.includes(value)) ?? statusValues[0] ?? "未着手",
      });
    }
    notify("AIアシストがルール案を作成しました");
  };

  const applyBundle = async (bundle: Bundle) => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const result = await api(`/api/bundles/${bundle.id}/apply`, "POST", { project_id: projectId });
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
    if (!canAdmin || !window.confirm(`「${bundle.name}」バンドルを削除しますか？`)) return;
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
    if (!canEdit || !window.confirm("このアプリ連携を削除しますか？")) return;
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
      const next = await api(`/api/projects/${projectId}/email`, "PATCH", patch);
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
          setOpen((current) => !current);
          setPanel("home");
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
        <aside
          data-project-customize-drawer
          role="dialog"
          aria-modal="true"
          aria-label="プロジェクトをカスタマイズ"
          className="fixed inset-y-0 right-0 z-[70] flex w-[min(480px,100vw)] flex-col border-l border-neutral-200 bg-white shadow-2xl"
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
              <div className="p-5">
                <section>
                  <h3 className="text-[14px] font-semibold text-neutral-900">このプロジェクト</h3>
                  <p className="mt-0.5 text-[12px] text-neutral-500">このプロジェクトの機能を表示、編集する</p>
                  <div className="mt-3 space-y-2">
                    <CustomizeRow
                      icon={
                        <ProjectIcon
                          id={projectId}
                          name={projectName}
                          color={color}
                          icon={icon}
                          className="h-7 w-7 text-[11px]"
                        />
                      }
                      title="カラーとアイコン"
                      description={projectName}
                      onClick={() => setPanel("appearance")}
                    />
                    {statusFieldEnabled && (
                      <CustomizeRow
                        icon={<StatusGlyph />}
                        title={statusFieldName}
                        description={statusValues.length ? statusValues.join(" ・ ") : "ステータスを設定"}
                        count={statusValues.length}
                        onClick={() => setPanel("status")}
                      />
                    )}
                  </div>
                </section>

                <section className="mt-6">
                  <h3 className="text-[14px] font-semibold text-neutral-900">ワークフロー機能</h3>
                  <p className="mt-0.5 text-[12px] text-neutral-500">タスクの入力項目と作成テンプレートを管理する</p>
                  <div className="mt-3 space-y-2">
                    <CustomizeRow
                      icon={<FieldGlyph />}
                      title="フィールド"
                      description="タスクに数値・テキスト・単一選択の項目を追加"
                      count={fields.length + (statusFieldEnabled ? 1 : 0)}
                      onClick={() => setPanel("fields")}
                    />
                    <CustomizeRow
                      icon={<TemplateGlyph />}
                      title="タスクタイプとテンプレート"
                      description="繰り返し使うタスクの型を登録"
                      count={templates.length}
                      onClick={() => setPanel("templates")}
                    />
                    <CustomizeRow
                      icon={<MailGlyph />}
                      title="メールアドレス"
                      description="プロジェクト宛メールからタスクを作成"
                      onClick={() => setPanel("email")}
                    />
                    <CustomizeRow
                      icon={<AppsGlyph />}
                      title="アプリ"
                      description="Slack・Google Drive・Webhookなどと連携"
                      count={initialApps.length}
                      onClick={() => setPanel("apps")}
                    />
                    <CustomizeRow
                      icon={<BundleGlyph />}
                      title="バンドル"
                      description="複数のフィールドをまとめてプロジェクトへ追加"
                      count={initialBundles.filter((bundle) => bundle.applied).length}
                      onClick={() => setPanel("bundles")}
                    />
                    <CustomizeRow
                      icon={<AutomationGlyph />}
                      title="AIと自動化"
                      description="ルールとAIアシストで作業を自動化"
                      count={initialAutomations.filter((rule) => rule.enabled).length}
                      onClick={() => setPanel("automations")}
                    />
                  </div>
                </section>

                <p className="mt-6 rounded-md bg-neutral-50 px-3 py-2 text-[11px] leading-4 text-neutral-500">
                  カスタマイズはこのプロジェクトに保存され、リスト・ボード・タイムラインなどの各ビューに反映されます。
                </p>
              </div>
            )}

            {panel === "appearance" && (
              <div className="p-5">
                <p className="text-[13px] text-neutral-600">
                  プロジェクトのカラーとアイコンを変更します。変更はすぐに保存されます。
                </p>
                {!canAdmin && (
                  <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    色とアイコンの変更はプロジェクト管理者のみ可能です。
                  </p>
                )}
                <div className="mt-5 text-[12px] font-semibold text-neutral-700">カラー</div>
                <div className="mt-2 grid grid-cols-8 gap-2">
                  {PROJECT_COLORS.map((entry) => (
                    <button
                      key={entry.name}
                      type="button"
                      title={entry.name}
                      disabled={!canAdmin || busy}
                      onClick={() => void saveAppearance({ color: entry.value })}
                      className={`flex h-6 w-6 items-center justify-center rounded-[5px] border border-black/10 text-xs text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.45)] disabled:cursor-not-allowed disabled:opacity-50 ${
                        color === entry.value ? "ring-2 ring-[#2c60b8] ring-offset-1" : ""
                      }`}
                      style={{ backgroundColor: entry.value ?? "#d9d9d9" }}
                    >
                      {color === entry.value ? "✓" : ""}
                    </button>
                  ))}
                </div>
                <div className="mt-5 text-[12px] font-semibold text-neutral-700">アイコン</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {PROJECT_ICONS.map((entry) => (
                    <button
                      key={entry.key ?? "none"}
                      type="button"
                      title={entry.label}
                      disabled={!canAdmin || busy}
                      onClick={() => void saveAppearance({ icon: entry.key })}
                      className={`flex h-9 w-9 items-center justify-center rounded-md border text-[10px] disabled:cursor-not-allowed disabled:opacity-50 ${
                        icon === entry.key
                          ? "border-[#2c60b8] bg-[#eff4fd] text-[#2c60b8]"
                          : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
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
            )}

            {panel === "status" && (
              <div className="p-5">
                <p className="text-[13px] text-neutral-600">
                  ステータスフィールドの名前と選択肢を編集します。選択肢名を変更すると、既存タスクの値も一緒に更新されます。
                </p>
                {!canAdmin && (
                  <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    ステータスの変更はプロジェクト管理者のみ可能です。
                  </p>
                )}
                <label className="mt-4 block text-[12px] font-medium text-neutral-700">
                  フィールド名
                  <input
                    data-customize-status-name
                    value={statusFieldName}
                    disabled={!canAdmin}
                    onChange={(event) => setStatusFieldName(event.target.value)}
                    className="mt-1 h-8 w-full rounded-md border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8] disabled:bg-neutral-50"
                  />
                </label>
                <div className="mt-4 text-[12px] font-medium text-neutral-700">選択肢</div>
                <div className="mt-2 space-y-2">
                  {statusDrafts.map((draft) => (
                    <div key={draft.key} className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[#8db8ff]" />
                      <input
                        data-customize-status-input={draft.key}
                        value={draft.value}
                        disabled={!canAdmin}
                        onChange={(event) =>
                          setStatusDrafts((current) =>
                            current.map((entry) =>
                              entry.key === draft.key ? { ...entry, value: event.target.value } : entry,
                            ),
                          )
                        }
                        className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8] disabled:bg-neutral-50"
                      />
                      {canAdmin && (
                        <button
                          type="button"
                          aria-label="ステータスを削除"
                          onClick={() => setStatusDrafts((current) => current.filter((entry) => entry.key !== draft.key))}
                          className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canAdmin && (
                  <>
                    <button
                      type="button"
                      data-customize-status-add
                      onClick={() =>
                        setStatusDrafts((current) => [
                          ...current,
                          { key: statusKey.current++, original: null, value: "新しいステータス" },
                        ])
                      }
                      className="mt-3 flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-[#2c60b8] hover:bg-[#eff4fd]"
                    >
                      ＋ ステータスを追加
                    </button>
                    <div className="mt-5 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => void deleteStatusField()}
                        className="text-[12px] text-red-600 hover:underline"
                      >
                        フィールドを削除
                      </button>
                      <button type="button" data-customize-status-save onClick={() => void saveStatusOptions()} disabled={busy} className={primaryButton}>
                        保存
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {panel === "email" && (
              <div className="p-5">
                <p className="text-[13px] text-neutral-600">
                  プロジェクト専用のメールアドレスです。受信ゲートウェイに届いたメールは、件名をタスク名、本文を説明として取り込みます。
                </p>
                <div className="mt-4 rounded-lg border border-[#e1e1e1] bg-neutral-50 p-3">
                  <div className="text-[11px] font-medium text-neutral-500">プロジェクトのメールアドレス</div>
                  <div className="mt-1 flex items-center gap-2">
                    <code data-customize-email-address className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 text-[12px] text-neutral-800">
                      {emailAddress || "生成中…"}
                    </code>
                    <button
                      type="button"
                      data-customize-email-copy
                      onClick={() => void copyEmail()}
                      disabled={!emailAddress}
                      className={secondaryButton}
                    >
                      {emailCopied ? "コピー済み" : "コピー"}
                    </button>
                  </div>
                </div>
                <label className="mt-4 flex items-center gap-2 text-[13px] text-neutral-700">
                  <input
                    type="checkbox"
                    data-customize-email-enabled
                    checked={emailEnabled}
                    disabled={!canEdit || busy}
                    onChange={(event) => void updateEmail({ enabled: event.target.checked })}
                    className="h-4 w-4 accent-[#2c60b8]"
                  />
                  メールからのタスク作成を有効にする
                </label>
                {canEdit && (
                  <button
                    type="button"
                    data-customize-email-regenerate
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("メールアドレスを再生成しますか？以前のアドレスは使えなくなります。")) {
                        void updateEmail({ regenerate: true });
                      }
                    }}
                    className="mt-4 text-[12px] text-[#2c60b8] hover:underline"
                  >
                    アドレスを再生成
                  </button>
                )}
                <p className="mt-5 rounded-md bg-neutral-50 px-3 py-2 text-[11px] leading-4 text-neutral-500">
                  実際のSMTP受信には外部ゲートウェイが必要です。Atlasでは認証済みの取り込みAPIで同じ処理を検証できます。
                </p>
              </div>
            )}

            {panel === "apps" && (
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] text-neutral-600">
                    プロジェクトで利用する外部アプリを管理します。連携設定はプロジェクト単位で保存されます。
                  </p>
                  {canEdit && (
                    <button
                      type="button"
                      data-customize-app-add
                      onClick={() => {
                        const available = APP_CATALOG.find(
                          (app) => !initialApps.some((installed) => installed.app_key === app.key),
                        );
                        if (!available) {
                          notify("追加できるアプリがありません");
                          return;
                        }
                        setAppDraft({ app_key: available.key, config: {} });
                      }}
                      className={secondaryButton}
                    >
                      ＋ アプリを追加
                    </button>
                  )}
                </div>
                <div className="mt-4 space-y-2">
                  {initialApps.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center text-[13px] text-neutral-500">
                      連携中のアプリはありません。
                    </div>
                  ) : (
                    initialApps.map((app) => {
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
                                    app.enabled
                                      ? "bg-green-100 text-green-800"
                                      : "bg-neutral-100 text-neutral-500"
                                  }`}
                                >
                                  {app.enabled ? "有効" : "無効"}
                                </span>
                              </div>
                              <div className="mt-0.5 text-[12px] text-neutral-500">
                                {definition?.description}
                              </div>
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
                                  onClick={() => void toggleApp(app)}
                                  className="h-7 rounded-md border border-[#e1e1e1] px-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
                                >
                                  {app.enabled ? "無効化" : "有効化"}
                                </button>
                                <button
                                  type="button"
                                  data-customize-app-remove={app.id}
                                  aria-label={`${definition?.name ?? app.app_key}を削除`}
                                  onClick={() => void removeApp(app)}
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
            )}

            {panel === "bundles" && (
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] text-neutral-600">
                    ワークスペースのバンドルは、複数のカスタムフィールドをまとめてプロジェクトへ追加できます。
                  </p>
                  {canAdmin && (
                    <button
                      type="button"
                      data-customize-bundle-add
                      onClick={() =>
                        setBundleDraft({
                          name: "",
                          description: "",
                          fields: [{ name: "優先度", field_type: "select", options: ["高", "中", "低"] }],
                        })
                      }
                      className={secondaryButton}
                    >
                      ＋ 作成
                    </button>
                  )}
                </div>
                <div className="mt-4 space-y-2">
                  {initialBundles.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center text-[13px] text-neutral-500">
                      利用できるバンドルはありません。
                    </div>
                  ) : (
                    initialBundles.map((bundle) => (
                      <div
                        key={bundle.id}
                        data-customize-bundle={bundle.id}
                        className="rounded-lg border border-[#e1e1e1] bg-white px-4 py-3"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-medium text-neutral-900">{bundle.name}</span>
                              {bundle.applied && (
                                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] text-green-800">
                                  適用済み
                                </span>
                              )}
                            </div>
                            {bundle.description && (
                              <div className="mt-0.5 text-[12px] text-neutral-500">{bundle.description}</div>
                            )}
                            <div className="mt-1 text-[11px] text-neutral-400">
                              {bundle.fields.length} フィールド ・ {bundle.applied_count} プロジェクトで利用
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {bundle.fields.map((field) => (
                                <span key={field.name} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                                  {field.name}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              data-customize-bundle-apply={bundle.id}
                              disabled={!canEdit || busy || bundle.applied}
                              onClick={() => void applyBundle(bundle)}
                              className="h-7 rounded-md bg-[#eff4fd] px-2 text-[12px] font-medium text-[#2c60b8] hover:bg-[#e1ecfc] disabled:opacity-40"
                            >
                              {bundle.applied ? "適用済み" : "適用"}
                            </button>
                            {canAdmin && (
                              <button
                                type="button"
                                data-customize-bundle-remove={bundle.id}
                                aria-label={`${bundle.name}を削除`}
                                onClick={() => void removeBundle(bundle)}
                                className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-600"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {panel === "automations" && (
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] text-neutral-600">
                    タスクの作成・完了・Status変更をきっかけに、Status変更・担当者変更・コメント追加を自動実行します。
                  </p>
                  {canEdit && (
                    <button
                      type="button"
                      data-customize-automation-add
                      onClick={() =>
                        setAutomationDraft({
                          name: "",
                          trigger: "task_created",
                          action_type: "set_status",
                          action_value: statusValues[0] ?? "未着手",
                        })
                      }
                      className={secondaryButton}
                    >
                      ＋ ルール
                    </button>
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-[#dbe7fb] bg-[#f5f9ff] p-3">
                  <div className="text-[12px] font-semibold text-[#24529c]">AIアシスト（ローカル提案）</div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={aiPrompt}
                      onChange={(event) => setAiPrompt(event.target.value)}
                      data-customize-ai-prompt
                      placeholder="例: 新規タスクを進行中にして"
                      className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[12px] outline-none focus:border-[#2c60b8]"
                    />
                    <button
                      type="button"
                      data-customize-ai-suggest
                      onClick={aiSuggest}
                      className="h-8 shrink-0 rounded-md bg-[#2c60b8] px-3 text-[12px] font-medium text-white hover:bg-[#24529c]"
                    >
                      提案
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {initialAutomations.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center text-[13px] text-neutral-500">
                      自動化ルールはありません。
                    </div>
                  ) : (
                    initialAutomations.map((rule) => {
                      const triggerLabel =
                        AUTOMATION_TRIGGERS.find((entry) => entry.value === rule.trigger)?.label ?? rule.trigger;
                      const actionLabel =
                        AUTOMATION_ACTIONS.find((entry) => entry.value === rule.action_type)?.label ??
                        rule.action_type;
                      return (
                        <div
                          key={rule.id}
                          data-customize-automation={rule.id}
                          className="rounded-lg border border-[#e1e1e1] bg-white px-4 py-3"
                        >
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[14px] font-medium text-neutral-900">{rule.name}</span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                                    rule.enabled
                                      ? "bg-green-100 text-green-800"
                                      : "bg-neutral-100 text-neutral-500"
                                  }`}
                                >
                                  {rule.enabled ? "有効" : "無効"}
                                </span>
                              </div>
                              <div className="mt-0.5 text-[12px] text-neutral-500">
                                {triggerLabel} → {actionLabel}: {rule.action_value}
                              </div>
                            </div>
                            {canEdit && (
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  data-customize-automation-toggle={rule.id}
                                  onClick={() => void toggleAutomation(rule)}
                                  className="h-7 rounded-md border border-[#e1e1e1] px-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
                                >
                                  {rule.enabled ? "無効化" : "有効化"}
                                </button>
                                <button
                                  type="button"
                                  data-customize-automation-remove={rule.id}
                                  aria-label={`${rule.name}を削除`}
                                  onClick={() => void removeAutomation(rule)}
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
            )}

            {panel === "fields" && (
              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[14px] font-semibold text-neutral-900">プロジェクトに追加済み</h3>
                    <p className="mt-0.5 text-[12px] text-neutral-500">{fields.length + (statusFieldEnabled ? 1 : 0)} 件のフィールド</p>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      data-customize-add-field
                      onClick={() => setFieldDraft({ id: null, name: "", field_type: "text", options: "" })}
                      className={secondaryButton}
                    >
                      ＋ 追加
                    </button>
                  )}
                </div>
                <div className="mt-4 space-y-2">
                  {statusFieldEnabled && (
                    <div className="rounded-lg border border-[#e1e1e1] px-4 py-3">
                      <div className="flex items-start gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[11px] font-semibold text-neutral-600">
                          {FIELD_TYPE_ICONS.select}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] font-medium text-neutral-900">{statusFieldName}</div>
                          <div className="mt-0.5 text-[12px] text-neutral-500">
                            単一選択
                            {statusValues.length > 0 ? ` ・ ${statusValues.join(" / ")}` : ""}
                          </div>
                        </div>
                        {canAdmin && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              data-customize-status-field-edit
                              aria-label={`${statusFieldName}を編集`}
                              onClick={() => setPanel("status")}
                              className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                            >
                              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                                <path d="m10.5 2.5 3 3L6 13H3v-3z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              data-customize-status-field-delete
                              aria-label={`${statusFieldName}を削除`}
                              onClick={() => void deleteStatusField()}
                              className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                                <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8h5.8l.6-8M6.5 7v3M9.5 7v3" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {!statusFieldEnabled && canAdmin && (
                    <button
                      type="button"
                      data-customize-status-field-add
                      onClick={() => void restoreStatusField()}
                      className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 px-4 py-3 text-[13px] text-[#2c60b8] hover:bg-[#eff4fd]"
                    >
                      ＋ Statusフィールドを追加
                    </button>
                  )}
                  {fields.length === 0 && !statusFieldEnabled ? (
                    <p className="rounded-lg border border-dashed border-neutral-200 px-4 py-6 text-center text-[13px] text-neutral-500">
                      フィールドがありません。追加してタスクの入力項目を増やせます。
                    </p>
                  ) : (
                    fields.map((field) => (
                      <div key={field.id} className="rounded-lg border border-[#e1e1e1] px-4 py-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[11px] font-semibold text-neutral-600">
                            {FIELD_TYPE_ICONS[field.field_type]}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-medium text-neutral-900">{field.name}</div>
                            <div className="mt-0.5 text-[12px] text-neutral-500">
                              {FIELD_TYPE_LABELS[field.field_type]}
                              {field.field_type === "select" && field.options.length > 0
                                ? ` ・ ${field.options.join(" / ")}`
                                : ""}
                            </div>
                          </div>
                          {canEdit && (
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                data-customize-field-edit={field.id}
                                aria-label={`${field.name}を編集`}
                                onClick={() =>
                                  setFieldDraft({
                                    id: field.id,
                                    name: field.name,
                                    field_type: field.field_type,
                                    options: field.options.join(", "),
                                  })
                                }
                                className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                              >
                                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                                  <path d="m10.5 2.5 3 3L6 13H3v-3z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                data-customize-field-delete={field.id}
                                aria-label={`${field.name}を削除`}
                                onClick={() => void removeField(field)}
                                className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                                  <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8h5.8l.6-8M6.5 7v3M9.5 7v3" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {canEdit && (
                  <div data-field-library className="mt-6 border-t border-neutral-200 pt-5">
                    <div>
                      <h3 className="text-[14px] font-semibold text-neutral-900">フィールドライブラリ</h3>
                      <p className="mt-0.5 text-[12px] text-neutral-500">
                        よく使うフィールドをワンクリックで追加できます
                      </p>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {FIELD_LIBRARY.map((preset) => {
                        const added = fields.some((field) => field.name === preset.name);
                        return (
                          <div
                            key={preset.name}
                            data-field-library-item={preset.name}
                            className={`rounded-lg border px-3 py-2.5 ${
                              added ? "border-neutral-200 bg-neutral-50" : "border-[#e1e1e1] bg-white"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-neutral-100 text-[10px] font-semibold text-neutral-600">
                                {FIELD_TYPE_ICONS[preset.field_type]}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-[13px] font-medium text-neutral-900">{preset.name}</div>
                                <div className="mt-0.5 text-[11px] leading-4 text-neutral-500">{preset.description}</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              data-field-library-add={preset.name}
                              disabled={added || busy}
                              onClick={() => void addLibraryField(preset)}
                              className={`mt-2 h-7 w-full rounded-md text-[12px] font-medium ${
                                added
                                  ? "cursor-default bg-neutral-100 text-neutral-400"
                                  : "bg-[#eff4fd] text-[#2c60b8] hover:bg-[#e1ecfc] disabled:opacity-50"
                              }`}
                            >
                              {added ? "追加済み" : "＋ 追加"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {panel === "templates" && (
              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[14px] font-semibold text-neutral-900">タスクテンプレート</h3>
                    <p className="mt-0.5 text-[12px] text-neutral-500">繰り返し使うタスクをワンクリックで作成</p>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      data-customize-add-template
                      onClick={() =>
                        setTemplateDraft({
                          id: null,
                          name: "",
                          title: "",
                          assignee: "",
                          offset: "",
                          section: sections[0] ? String(sections[0].id) : "",
                          subtasks: "",
                        })
                      }
                      className={secondaryButton}
                    >
                      ＋ 追加
                    </button>
                  )}
                </div>
                <div className="mt-4 space-y-2">
                  {templates.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-neutral-200 px-4 py-6 text-center text-[13px] text-neutral-500">
                      テンプレートがありません。よく使うタスクを登録しておくと便利です。
                    </p>
                  ) : (
                    templates.map((template) => (
                      <div key={template.id} className="rounded-lg border border-[#e1e1e1] px-4 py-3">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-medium text-neutral-900">{template.name}</div>
                            <div className="mt-0.5 truncate text-[12px] text-neutral-600">タスク: {template.title_template}</div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
                              <span>担当: {template.assignee_name ?? "なし"}</span>
                              <span>期日: {template.due_offset_days === null ? "なし" : `今日 +${template.due_offset_days}日`}</span>
                              <span>セクション: {template.section_name ?? "なし"}</span>
                              {template.subtasks.length > 0 && <span>サブタスク: {template.subtasks.length}件</span>}
                            </div>
                          </div>
                          {canEdit && (
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                data-customize-template-edit={template.id}
                                aria-label={`${template.name}を編集`}
                                onClick={() =>
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
                                className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                              >
                                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                                  <path d="m10.5 2.5 3 3L6 13H3v-3z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                data-customize-template-use={template.id}
                                onClick={() => void instantiateTemplate(template)}
                                className="h-7 rounded-md bg-[#eff4fd] px-2 text-[12px] font-medium text-[#2c60b8] hover:bg-[#e1ecfc]"
                              >
                                使用
                              </button>
                              <button
                                type="button"
                                data-customize-template-delete={template.id}
                                aria-label={`${template.name}を削除`}
                                onClick={() => void removeTemplate(template)}
                                className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                                  <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8h5.8l.6-8M6.5 7v3M9.5 7v3" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {toast && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md bg-neutral-800 px-3 py-1.5 text-[12px] text-white shadow-lg">
              {toast}
            </div>
          )}
        </aside>
      )}

      {fieldDraft && (
        <Modal title={fieldDraft.id === null ? "フィールドを追加" : "フィールドを編集"} onClose={() => setFieldDraft(null)}>
          <form onSubmit={saveField} className="p-5">
            <label className="block text-[12px] font-medium text-neutral-700">
              フィールド名
              <input
                data-customize-field-name
                value={fieldDraft.name}
                onChange={(event) => setFieldDraft({ ...fieldDraft, name: event.target.value })}
                placeholder="優先度、ステージ、見積もり…"
                className={fieldTypeClass}
              />
            </label>
            <label className="mt-4 block text-[12px] font-medium text-neutral-700">
              フィールドタイプ
              <select
                data-customize-field-type
                value={fieldDraft.field_type}
                disabled={fieldDraft.id !== null}
                onChange={(event) =>
                  setFieldDraft({ ...fieldDraft, field_type: event.target.value as CustomField["field_type"] })
                }
                className={`${fieldTypeClass} disabled:bg-neutral-50 disabled:text-neutral-500`}
              >
                <option value="text">テキスト</option>
                <option value="number">数値</option>
                <option value="select">単一選択</option>
              </select>
            </label>
            {fieldDraft.field_type === "select" && (
              <label className="mt-4 block text-[12px] font-medium text-neutral-700">
                オプション
                <textarea
                  data-customize-field-options
                  value={fieldDraft.options}
                  onChange={(event) => setFieldDraft({ ...fieldDraft, options: event.target.value })}
                  placeholder="低, 中, 高"
                  rows={3}
                  className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-[13px] outline-none focus:border-[#2c60b8]"
                />
                <span className="mt-1 block text-[11px] font-normal text-neutral-400">カンマまたは改行で区切ってください。</span>
              </label>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setFieldDraft(null)} className={secondaryButton}>
                キャンセル
              </button>
              <button type="submit" data-customize-field-save disabled={busy} className={primaryButton}>
                {fieldDraft.id === null ? "フィールドを作成" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {templateDraft && (
        <Modal title={templateDraft.id === null ? "テンプレートを追加" : "テンプレートを編集"} onClose={() => setTemplateDraft(null)}>
          <form onSubmit={saveTemplate} className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-[12px] font-medium text-neutral-700">
                テンプレート名
                <input
                  data-customize-template-name
                  value={templateDraft.name}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })}
                  placeholder="週次レビュー"
                  className={fieldTypeClass}
                />
              </label>
              <label className="block text-[12px] font-medium text-neutral-700">
                タスク名
                <input
                  data-customize-template-title
                  value={templateDraft.title}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, title: event.target.value })}
                  placeholder="週次レビューを実施"
                  className={fieldTypeClass}
                />
              </label>
              <label className="block text-[12px] font-medium text-neutral-700">
                担当者
                <select
                  value={templateDraft.assignee}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, assignee: event.target.value })}
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
              <label className="block text-[12px] font-medium text-neutral-700">
                期日（今日からの日数）
                <input
                  value={templateDraft.offset}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, offset: event.target.value })}
                  inputMode="numeric"
                  placeholder="3"
                  className={fieldTypeClass}
                />
              </label>
              <label className="block text-[12px] font-medium text-neutral-700">
                セクション
                <select
                  value={templateDraft.section}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, section: event.target.value })}
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
              <label className="block text-[12px] font-medium text-neutral-700 sm:col-span-2">
                サブタスク
                <textarea
                  value={templateDraft.subtasks}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, subtasks: event.target.value })}
                  placeholder="資料を準備する, 関係者に共有する"
                  rows={2}
                  className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-[13px] outline-none focus:border-[#2c60b8]"
                />
                <span className="mt-1 block text-[11px] font-normal text-neutral-400">カンマまたは改行で区切ってください。</span>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setTemplateDraft(null)} className={secondaryButton}>
                キャンセル
              </button>
              <button type="submit" data-customize-template-save disabled={busy} className={primaryButton}>
                {templateDraft.id === null ? "テンプレートを作成" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {automationDraft && (
        <Modal title="自動化ルール" onClose={() => setAutomationDraft(null)}>
          <form onSubmit={saveAutomation} data-customize-automation-form className="p-5">
            <label className="block text-[12px] font-medium text-neutral-700">
              ルール名
              <input
                value={automationDraft.name}
                onChange={(event) => setAutomationDraft({ ...automationDraft, name: event.target.value })}
                data-customize-automation-name
                placeholder="例: 新規タスクを進行中にする"
                className={fieldTypeClass}
              />
            </label>
            <label className="mt-3 block text-[12px] font-medium text-neutral-700">
              きっかけ
              <select
                value={automationDraft.trigger}
                onChange={(event) =>
                  setAutomationDraft({
                    ...automationDraft,
                    trigger: event.target.value as AutomationTrigger,
                  })
                }
                data-customize-automation-trigger
                className={fieldTypeClass}
              >
                {AUTOMATION_TRIGGERS.map((trigger) => (
                  <option key={trigger.value} value={trigger.value}>
                    {trigger.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-[12px] font-medium text-neutral-700">
              アクション
              <select
                value={automationDraft.action_type}
                onChange={(event) =>
                  setAutomationDraft({
                    ...automationDraft,
                    action_type: event.target.value as AutomationAction,
                    action_value:
                      event.target.value === "set_status"
                        ? statusValues[0] ?? "未着手"
                        : event.target.value === "set_assignee"
                          ? String(users[0]?.id ?? "")
                          : "",
                  })
                }
                data-customize-automation-action
                className={fieldTypeClass}
              >
                {AUTOMATION_ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>
                    {action.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-[12px] font-medium text-neutral-700">
              値
              {automationDraft.action_type === "set_status" ? (
                <select
                  value={automationDraft.action_value}
                  onChange={(event) =>
                    setAutomationDraft({ ...automationDraft, action_value: event.target.value })
                  }
                  data-customize-automation-value
                  className={fieldTypeClass}
                >
                  {statusValues.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : automationDraft.action_type === "set_assignee" ? (
                <select
                  value={automationDraft.action_value}
                  onChange={(event) =>
                    setAutomationDraft({ ...automationDraft, action_value: event.target.value })
                  }
                  data-customize-automation-value
                  className={fieldTypeClass}
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={automationDraft.action_value}
                  onChange={(event) =>
                    setAutomationDraft({ ...automationDraft, action_value: event.target.value })
                  }
                  data-customize-automation-value
                  placeholder="コメント本文"
                  className={fieldTypeClass}
                />
              )}
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setAutomationDraft(null)} className={secondaryButton}>
                キャンセル
              </button>
              <button type="submit" data-customize-automation-save disabled={busy} className={primaryButton}>
                保存
              </button>
            </div>
          </form>
        </Modal>
      )}

      {bundleDraft && (
        <Modal title="バンドルを作成" onClose={() => setBundleDraft(null)}>
          <form onSubmit={saveBundle} data-customize-bundle-form className="p-5">
            <label className="block text-[12px] font-medium text-neutral-700">
              バンドル名
              <input
                value={bundleDraft.name}
                onChange={(event) => setBundleDraft({ ...bundleDraft, name: event.target.value })}
                data-customize-bundle-name
                placeholder="例: プロジェクト管理セット"
                className={fieldTypeClass}
              />
            </label>
            <label className="mt-3 block text-[12px] font-medium text-neutral-700">
              説明
              <input
                value={bundleDraft.description}
                onChange={(event) => setBundleDraft({ ...bundleDraft, description: event.target.value })}
                className={fieldTypeClass}
              />
            </label>
            <div className="mt-4 flex items-center justify-between">
              <div className="text-[12px] font-medium text-neutral-700">フィールド</div>
              <button
                type="button"
                data-customize-bundle-field-add
                onClick={() =>
                  setBundleDraft({
                    ...bundleDraft,
                    fields: [...bundleDraft.fields, { name: "", field_type: "text", options: [] }],
                  })
                }
                className="text-[12px] text-[#2c60b8] hover:underline"
              >
                ＋ フィールドを追加
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {bundleDraft.fields.map((field, index) => (
                <div key={index} className="rounded-md border border-neutral-200 p-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={field.name}
                      onChange={(event) =>
                        setBundleDraft({
                          ...bundleDraft,
                          fields: bundleDraft.fields.map((entry, i) =>
                            i === index ? { ...entry, name: event.target.value } : entry,
                          ),
                        })
                      }
                      data-customize-bundle-field-name={index}
                      placeholder="フィールド名"
                      className="h-7 min-w-0 flex-1 rounded border border-neutral-200 px-2 text-[12px] outline-none focus:border-[#2c60b8]"
                    />
                    <select
                      value={field.field_type}
                      onChange={(event) =>
                        setBundleDraft({
                          ...bundleDraft,
                          fields: bundleDraft.fields.map((entry, i) =>
                            i === index
                              ? { ...entry, field_type: event.target.value as BundleField["field_type"] }
                              : entry,
                          ),
                        })
                      }
                      data-customize-bundle-field-type={index}
                      className="h-7 rounded border border-neutral-200 bg-white px-1 text-[12px]"
                    >
                      <option value="text">テキスト</option>
                      <option value="number">数値</option>
                      <option value="select">単一選択</option>
                    </select>
                    {bundleDraft.fields.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setBundleDraft({
                            ...bundleDraft,
                            fields: bundleDraft.fields.filter((_, i) => i !== index),
                          })
                        }
                        className="text-neutral-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {field.field_type === "select" && (
                    <input
                      value={field.options.join(", ")}
                      onChange={(event) =>
                        setBundleDraft({
                          ...bundleDraft,
                          fields: bundleDraft.fields.map((entry, i) =>
                            i === index
                              ? {
                                  ...entry,
                                  options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean),
                                }
                              : entry,
                          ),
                        })
                      }
                      data-customize-bundle-field-options={index}
                      placeholder="選択肢（カンマ区切り）"
                      className="mt-2 h-7 w-full rounded border border-neutral-200 px-2 text-[12px] outline-none focus:border-[#2c60b8]"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setBundleDraft(null)} className={secondaryButton}>
                キャンセル
              </button>
              <button type="submit" data-customize-bundle-save disabled={busy} className={primaryButton}>
                作成
              </button>
            </div>
          </form>
        </Modal>
      )}

      {appDraft && (
        <Modal title="アプリを追加" onClose={() => setAppDraft(null)}>
          <form onSubmit={installApp} data-customize-app-form className="p-5">
            <label className="block text-[12px] font-medium text-neutral-700">
              アプリ
              <select
                value={appDraft.app_key}
                onChange={(event) => setAppDraft({ app_key: event.target.value, config: {} })}
                data-customize-app-select
                className={fieldTypeClass}
              >
                {APP_CATALOG.filter(
                  (app) => !initialApps.some((installed) => installed.app_key === app.key),
                ).map((app) => (
                  <option key={app.key} value={app.key}>
                    {app.name}
                  </option>
                ))}
              </select>
            </label>
            {(() => {
              const definition = APP_CATALOG.find((app) => app.key === appDraft.app_key);
              if (!definition) return null;
              return (
                <>
                  <p className="mt-2 text-[12px] text-neutral-500">{definition.description}</p>
                  {definition.fields.map((field) => (
                    <label key={field.key} className="mt-3 block text-[12px] font-medium text-neutral-700">
                      {field.label}
                      {field.required && <span className="ml-1 text-red-500">*</span>}
                      <input
                        value={appDraft.config[field.key] ?? ""}
                        onChange={(event) =>
                          setAppDraft({
                            ...appDraft,
                            config: { ...appDraft.config, [field.key]: event.target.value },
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
              <button type="button" onClick={() => setAppDraft(null)} className={secondaryButton}>
                キャンセル
              </button>
              <button type="submit" data-customize-app-save disabled={busy} className={primaryButton}>
                追加
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
