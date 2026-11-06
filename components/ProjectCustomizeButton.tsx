"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Section, TaskTemplate, User } from "@/lib/data";
import type { CustomField } from "@/lib/custom-fields";
import { PROJECT_COLORS, PROJECT_ICONS, projectColor, type ProjectIconKey } from "@/lib/project-appearance";
import { canEditProject, canManageProject, type ProjectRole } from "@/lib/project-roles";
import ProjectIcon from "./ProjectIcon";

type Panel = "home" | "appearance" | "status" | "fields" | "templates";

type FieldDraft = {
  id: number | null;
  name: string;
  field_type: CustomField["field_type"];
  options: string;
};

type TemplateDraft = {
  name: string;
  title: string;
  assignee: string;
  offset: string;
  section: string;
  subtasks: string;
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
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/25 p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
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
  initialFields,
  sections,
  users,
  role,
}: {
  projectId: number;
  projectName: string;
  initialColor: string | null;
  initialIcon: string | null;
  initialStatusOptions: string[];
  initialFields: CustomField[];
  sections: Section[];
  users: User[];
  role: ProjectRole;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("home");
  const [color, setColor] = useState<string | null>(initialColor);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [statusOptions, setStatusOptions] = useState<string[]>(initialStatusOptions);
  const [fields, setFields] = useState<CustomField[]>(initialFields);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

  const canEdit = canEditProject(role);
  const canAdmin = canManageProject(role);

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2400);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [nextFields, nextTemplates] = await Promise.all([fetchFields(projectId), fetchTemplates(projectId)]);
      if (!cancelled) {
        setFields(nextFields);
        setTemplates(nextTemplates);
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
    const options = statusOptions.map((o) => o.trim()).filter(Boolean);
    if (options.length === 0) {
      notify("ステータスを1つ以上入力してください");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}`, "PATCH", { status_options: options });
      setStatusOptions(options);
      router.refresh();
      notify("ステータスを更新しました");
    } catch {
      notify("ステータスの更新に失敗しました");
    } finally {
      setBusy(false);
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

  const saveTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!templateDraft || !canEdit) return;
    if (!templateDraft.name.trim() || !templateDraft.title.trim()) {
      notify("テンプレート名とタスク名を入力してください");
      return;
    }
    setBusy(true);
    try {
      await api("/api/task-templates", "POST", {
        project_id: projectId,
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
      });
      setTemplates(await fetchTemplates(projectId));
      setTemplateDraft(null);
      notify("テンプレートを追加しました");
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

  const panelTitle: Record<Panel, string> = {
    home: "カスタマイズ",
    appearance: "カラーとアイコン",
    status: "ステータス",
    fields: "フィールド",
    templates: "タスクタイプとテンプレート",
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
                    <CustomizeRow
                      icon={<StatusGlyph />}
                      title="ステータス"
                      description={statusOptions.length ? statusOptions.join(" ・ ") : "ステータスを設定"}
                      count={statusOptions.length}
                      onClick={() => setPanel("status")}
                    />
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
                      count={fields.length}
                      onClick={() => setPanel("fields")}
                    />
                    <CustomizeRow
                      icon={<TemplateGlyph />}
                      title="タスクタイプとテンプレート"
                      description="繰り返し使うタスクの型を登録"
                      count={templates.length}
                      onClick={() => setPanel("templates")}
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
                <p className="text-[13px] text-neutral-600">プロジェクトのステータス選択肢を編集します。</p>
                {!canAdmin && (
                  <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    ステータスの変更はプロジェクト管理者のみ可能です。
                  </p>
                )}
                <div className="mt-4 space-y-2">
                  {statusOptions.map((option, index) => (
                    <div key={`${index}-${option}`} className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[#8db8ff]" />
                      <input
                        data-customize-status-input={index}
                        value={option}
                        disabled={!canAdmin}
                        onChange={(event) =>
                          setStatusOptions((current) =>
                            current.map((value, i) => (i === index ? event.target.value : value)),
                          )
                        }
                        className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8] disabled:bg-neutral-50"
                      />
                      {canAdmin && (
                        <button
                          type="button"
                          aria-label="ステータスを削除"
                          onClick={() => setStatusOptions((current) => current.filter((_, i) => i !== index))}
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
                      onClick={() => setStatusOptions((current) => [...current, "新しいステータス"])}
                      className="mt-3 flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-[#2c60b8] hover:bg-[#eff4fd]"
                    >
                      ＋ ステータスを追加
                    </button>
                    <div className="mt-5 flex justify-end">
                      <button type="button" data-customize-status-save onClick={() => void saveStatusOptions()} disabled={busy} className={primaryButton}>
                        保存
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {panel === "fields" && (
              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[14px] font-semibold text-neutral-900">プロジェクトに追加済み</h3>
                    <p className="mt-0.5 text-[12px] text-neutral-500">{fields.length} 件のフィールド</p>
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
                  {fields.length === 0 ? (
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
                autoFocus
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
        <Modal title="テンプレートを追加" onClose={() => setTemplateDraft(null)}>
          <form onSubmit={saveTemplate} className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-[12px] font-medium text-neutral-700">
                テンプレート名
                <input
                  autoFocus
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
                テンプレートを作成
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
