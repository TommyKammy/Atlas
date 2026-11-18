"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/dates";
import type { ProjectTemplateSummary } from "@/lib/project-templates";
import { confirmAction, toast } from "@/lib/ui-feedback";
import ProjectIcon from "../ProjectIcon";

type View = "gallery" | "blank" | "template";
type Scope = "all" | "mine";

export default function ProjectCreateScreen({
  workspaceId,
  workspaceName,
  viewerId,
  isWorkspaceAdmin,
  templates: initialTemplates,
}: {
  workspaceId: number;
  workspaceName: string;
  viewerId: number;
  isWorkspaceAdmin: boolean;
  templates: ProjectTemplateSummary[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("gallery");
  const [scope, setScope] = useState<Scope>("all");
  const [templates, setTemplates] = useState(initialTemplates);
  const [selected, setSelected] = useState<ProjectTemplateSummary | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return templates;
    return templates.filter((template) =>
      `${template.name} ${template.description} ${template.sample_tasks.join(" ")}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query, templates]);
  const builtins = filtered.filter((template) => template.is_builtin);
  const workspaceTemplates = filtered.filter((template) => !template.is_builtin);
  const mine = workspaceTemplates.filter((template) => template.created_by === viewerId);
  const others = workspaceTemplates.filter((template) => template.created_by !== viewerId);
  const visibleBuiltins =
    category === "all" ? builtins : builtins.filter((template) => template.category === category);
  const categories = useMemo(
    () =>
      [...new Set(templates.filter((template) => template.is_builtin).map((template) => template.category))]
        .filter((value) => value !== ""),
    [templates],
  );

  const openGallery = (nextScope: Scope = scope) => {
    setView("gallery");
    setScope(nextScope);
    setSelected(null);
    setName("");
    setError("");
  };

  const openBlank = () => {
    setView("blank");
    setSelected(null);
    setName("");
    setError("");
  };

  const openTemplate = (template: ProjectTemplateSummary) => {
    setView("template");
    setSelected(template);
    setName(template.name);
    setError("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result =
        view === "template" && selected
          ? await api<{ id: number }>(`/api/project-templates/${selected.id}`, "POST", {
              name: name.trim(),
            })
          : await api<{ id: number }>("/api/projects", "POST", {
              workspace_id: workspaceId,
              name: name.trim(),
            });
      router.push(`/projects/${result.id}?view=list`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "プロジェクトの作成に失敗しました");
      setBusy(false);
    }
  };

  const removeTemplate = async (template: ProjectTemplateSummary) => {
    if (!(await confirmAction(`テンプレート「${template.name}」を削除しますか？`))) return;
    try {
      await api(`/api/project-templates/${template.id}`, "DELETE");
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      if (selected?.id === template.id) openGallery();
      toast("テンプレートを削除しました");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "テンプレートの削除に失敗しました");
    }
  };

  const navClass = (active: boolean) =>
    `flex h-8 items-center rounded-md px-2.5 text-left text-[13px] ${
      active
        ? "bg-accent-soft font-medium text-accent-text"
        : "text-secondary hover:bg-neutral-100"
    }`;
  const primary =
    "rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-[#24529c] disabled:opacity-50";
  const secondary =
    "rounded-md border border-line-strong bg-surface px-4 py-2 text-[13px] text-neutral-700 hover:bg-neutral-50";

  const templateCard = (template: ProjectTemplateSummary) => (
    <div key={template.id} className="group relative">
      <button
        type="button"
        data-project-template-card={template.id}
        onClick={() => openTemplate(template)}
        className="flex h-full w-full items-start gap-3 rounded-xl border border-neutral-200 bg-surface p-4 text-left transition hover:border-[#4075cf] hover:shadow-sm"
      >
        <ProjectIcon
          id={template.id}
          name={template.name}
          color={template.color}
          icon={template.icon}
          className="mt-0.5 h-9 w-9 text-[13px]"
        />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block break-words text-[14px] font-medium leading-5 text-neutral-900">
            {template.name}
          </span>
          <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-muted">
            {template.description ||
              `${template.section_count}個のセクションと${template.task_count}個のタスクから作成`}
          </span>
          <span className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-subtle">
            <span>{template.section_count}セクション</span>
            <span>{template.task_count}タスク</span>
            {template.is_builtin ? (
              <span className="rounded bg-accent-soft px-1 text-accent-text">
                Atlas標準・{template.category}
              </span>
            ) : (
              template.creator_name && <span>作成: {template.creator_name}</span>
            )}
          </span>
        </span>
      </button>
      {isWorkspaceAdmin && !template.is_builtin && (
        <button
          type="button"
          data-project-template-delete={template.id}
          aria-label={`テンプレート「${template.name}」を削除`}
          title="テンプレートを削除"
          onClick={() => void removeTemplate(template)}
          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-surface text-[14px] text-neutral-400 opacity-0 shadow-sm transition hover:border-red-200 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );

  return (
    <div data-project-create-screen data-project-create-mode={view} className="min-h-full bg-[#f7f7f7]">
      <div className="mx-auto flex min-h-full w-full max-w-[1320px] flex-col lg:flex-row">
        <aside className="shrink-0 border-b border-neutral-200 bg-surface px-4 py-4 lg:w-[240px] lg:border-b-0 lg:border-r lg:px-4 lg:py-6">
          <Link href="/" className="text-[12px] text-muted hover:text-neutral-800">
            ← ホーム
          </Link>
          <h1 className="mt-3 text-[18px] font-semibold leading-6 text-neutral-900">
            プロジェクトを作成
          </h1>
          <p className="mt-0.5 truncate text-[11px] text-subtle">{workspaceName}</p>
          <nav className="mt-5 flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
            <button
              type="button"
              data-project-create-nav="gallery"
              onClick={() => openGallery("all")}
              className={navClass(view !== "blank" && scope === "all")}
            >
              テンプレートギャラリー
            </button>
            <button
              type="button"
              data-project-create-nav="mine"
              onClick={() => openGallery("mine")}
              className={navClass(view !== "blank" && scope === "mine")}
            >
              あなたのテンプレート
            </button>
            <button
              type="button"
              data-project-create-nav="blank"
              onClick={openBlank}
              className={navClass(view === "blank")}
            >
              空のプロジェクト
            </button>
          </nav>
          <div className="mt-6 hidden rounded-lg border border-neutral-200 bg-surface-subtle p-3 text-[11px] leading-5 text-muted lg:block">
            <div className="font-medium text-neutral-700">テンプレートを増やす</div>
            <p className="mt-1">
              プロジェクトの「…」メニューから「テンプレートとして保存」を選ぶと、ここに追加されます。
            </p>
          </div>
        </aside>

        <section className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
          {view === "gallery" && (
            <div data-project-create-gallery>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[22px] font-semibold leading-7 text-neutral-900">
                    テンプレートギャラリー
                  </h2>
                  <p className="mt-1 text-[13px] text-muted">
                    テンプレートから始めるか、空のプロジェクトを一から作成します。
                  </p>
                </div>
                <button type="button" onClick={openBlank} className={secondary}>
                  空のプロジェクト
                </button>
              </div>

              <div className="mt-4 flex max-w-xl items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-2">
                <span aria-hidden className="text-[14px] text-subtle">
                  ⌕
                </span>
                <input
                  data-project-create-search
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="テンプレートを検索"
                  aria-label="テンプレートを検索"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-neutral-400"
                />
                {query !== "" && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="検索をクリア"
                    className="text-[13px] text-subtle hover:text-neutral-700"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="mt-3 flex items-center gap-1 border-b border-neutral-200 pb-2">
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  data-project-create-scope="all"
                  aria-pressed={scope === "all"}
                  className={`rounded-full px-2.5 py-1 text-[12px] ${
                    scope === "all"
                      ? "bg-accent-soft font-medium text-accent-text"
                      : "text-muted hover:bg-neutral-100"
                  }`}
                >
                  すべて ({filtered.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScope("mine")}
                  data-project-create-scope="mine"
                  aria-pressed={scope === "mine"}
                  className={`rounded-full px-2.5 py-1 text-[12px] ${
                    scope === "mine"
                      ? "bg-accent-soft font-medium text-accent-text"
                      : "text-muted hover:bg-neutral-100"
                  }`}
                >
                  あなたのテンプレート ({mine.length})
                </button>
              </div>

              {scope === "all" && categories.length > 0 && (
                <div
                  data-project-template-categories
                  className="mt-3 flex flex-wrap items-center gap-1.5"
                >
                  <span className="mr-0.5 text-[11px] text-subtle">カテゴリ</span>
                  <button
                    type="button"
                    data-project-template-category="all"
                    aria-pressed={category === "all"}
                    onClick={() => setCategory("all")}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      category === "all"
                        ? "border-accent bg-accent-soft font-medium text-accent-text"
                        : "border-neutral-200 bg-surface text-muted hover:bg-neutral-50"
                    }`}
                  >
                    すべて
                  </button>
                  {categories.map((item) => (
                    <button
                      key={item}
                      type="button"
                      data-project-template-category={item}
                      aria-pressed={category === item}
                      onClick={() => setCategory(item)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        category === item
                          ? "border-accent bg-accent-soft font-medium text-accent-text"
                          : "border-neutral-200 bg-surface text-muted hover:bg-neutral-50"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                data-project-create-blank
                onClick={openBlank}
                className="mt-4 flex w-full items-center gap-4 rounded-xl border-2 border-dashed border-neutral-300 bg-white px-4 py-4 text-left hover:border-[#4075cf] hover:bg-[#fbfdff]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[20px] text-accent-text">
                  ＋
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-neutral-900">
                    空のプロジェクト
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    テンプレートを使わずに、計画中・進行中・完了のセクションから作成
                  </span>
                </span>
                <span aria-hidden className="text-[16px] text-neutral-300">
                  →
                </span>
              </button>

              {scope === "all" && visibleBuiltins.length > 0 && (
                <section className="mt-6">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[14px] font-semibold text-neutral-900">
                      Atlas おすすめテンプレート
                    </h3>
                    <span className="text-[11px] text-subtle">
                      {visibleBuiltins.length}件
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {visibleBuiltins.map(templateCard)}
                  </div>
                </section>
              )}

              {query.trim() !== "" && filtered.length === 0 && (
                <div className="mt-6 rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
                  <p className="text-[13px] text-muted">
                    「{query.trim()}」に一致するテンプレートはありません。
                  </p>
                </div>
              )}

              {query.trim() === "" && templates.length === 0 && (
                <div className="mt-6 rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
                  <div className="text-[24px] text-neutral-300">▤</div>
                  <h3 className="mt-2 text-[14px] font-medium text-neutral-800">
                    まだテンプレートがありません
                  </h3>
                  <p className="mx-auto mt-1 max-w-md text-[11px] leading-5 text-muted">
                    プロジェクトの「…」メニューから「テンプレートとして保存」を選ぶと、既存のプロジェクト構成をテンプレート化できます。
                  </p>
                </div>
              )}

              {scope === "all" && mine.length > 0 && (
                <section className="mt-6">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[14px] font-semibold text-neutral-900">
                      あなたのテンプレート
                    </h3>
                    <span className="text-[11px] text-subtle">{mine.length}件</span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {mine.map(templateCard)}
                  </div>
                </section>
              )}

              {scope === "mine" && mine.length > 0 && (
                <section className="mt-6">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[14px] font-semibold text-neutral-900">
                      あなたのテンプレート
                    </h3>
                    <span className="text-[11px] text-subtle">{mine.length}件</span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {mine.map(templateCard)}
                  </div>
                </section>
              )}

              {scope === "mine" && mine.length === 0 && templates.length > 0 && (
                <div className="mt-6 rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
                  <p className="text-[13px] text-muted">
                    あなたが作成したテンプレートはまだありません。
                  </p>
                </div>
              )}

              {scope === "all" && others.length > 0 && (
                <section className="mt-6">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[14px] font-semibold text-neutral-900">
                      ワークスペースのテンプレート
                    </h3>
                    <span className="text-[11px] text-subtle">{others.length}件</span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {others.map(templateCard)}
                  </div>
                </section>
              )}
            </div>
          )}

          {view === "blank" && (
            <div data-project-create-blank-view className="mx-auto max-w-2xl">
              <button
                type="button"
                onClick={() => openGallery()}
                className="text-[12px] text-muted hover:text-neutral-800"
              >
                ← テンプレート一覧に戻る
              </button>
              <div className="mt-4 rounded-xl border border-neutral-200 bg-surface p-6">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[22px] text-accent-text">
                    ＋
                  </span>
                  <div>
                    <h2 className="text-[20px] font-semibold text-neutral-900">空のプロジェクト</h2>
                    <p className="mt-1 text-[12px] leading-5 text-muted">
                      テンプレートを使わずに新しいプロジェクトを作成します。計画中・進行中・完了のセクションと既定のタブが用意されます。
                    </p>
                  </div>
                </div>
                <form onSubmit={submit} className="mt-6">
                  <label className="block text-[12px] font-medium text-neutral-700">
                    プロジェクト名
                    <input
                      data-project-create-name
                      autoFocus
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={200}
                      placeholder="例: 新製品リリース"
                      className="mt-1.5 w-full rounded-md border border-neutral-300 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#4075cf] focus:ring-2 focus:ring-[#4075cf]/20"
                    />
                  </label>
                  {error !== "" && <p className="mt-2 text-[12px] text-danger">{error}</p>}
                  <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={() => openGallery()} className={secondary}>
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      data-project-create-submit
                      disabled={busy || name.trim() === ""}
                      className={primary}
                    >
                      {busy ? "作成中…" : "プロジェクトを作成"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {view === "template" && selected && (
            <div data-project-template-detail={selected.id} className="mx-auto max-w-5xl">
              <button
                type="button"
                onClick={() => openGallery()}
                className="text-[12px] text-muted hover:text-neutral-800"
              >
                ← テンプレート一覧に戻る
              </button>
              <div className="mt-4 flex items-start gap-3">
                <ProjectIcon
                  id={selected.id}
                  name={selected.name}
                  color={selected.color}
                  icon={selected.icon}
                  className="h-11 w-11 text-[15px]"
                />
                <div className="min-w-0">
                  <h2 className="text-[22px] font-semibold leading-7 text-neutral-900">
                    {selected.name}
                  </h2>
                  <p className="mt-1 text-[12px] leading-5 text-muted">
                    {selected.description ||
                      `${selected.section_count}個のセクションと${selected.task_count}個のタスクを含むテンプレートです。`}
                  </p>
                  <div className="mt-1 text-[10px] text-subtle">
                    {selected.is_builtin
                      ? `Atlas標準テンプレート ・ ${selected.category}`
                      : selected.creator_name
                        ? `作成: ${selected.creator_name}`
                        : "ワークスペースのテンプレート"}
                    {!selected.is_builtin && selected.created_at
                      ? ` ・ ${formatDateTime(selected.created_at)}`
                      : ""}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-xl border border-neutral-200 bg-surface p-4">
                  <h3 className="text-[13px] font-semibold text-neutral-800">テンプレートの内容</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-surface-subtle px-3 py-2">
                      <div className="text-[18px] font-semibold text-neutral-800">
                        {selected.section_count}
                      </div>
                      <div className="text-[10px] text-subtle">セクション</div>
                    </div>
                    <div className="rounded-lg bg-surface-subtle px-3 py-2">
                      <div className="text-[18px] font-semibold text-neutral-800">
                        {selected.task_count}
                      </div>
                      <div className="text-[10px] text-subtle">タスク</div>
                    </div>
                  </div>
                  {selected.sections.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-[11px] font-medium text-muted">セクション</h4>
                      <div className="mt-1.5 divide-y divide-neutral-100 rounded-md border border-neutral-200">
                        {selected.sections.map((section, index) => (
                          <div
                            key={`${section.name}-${index}`}
                            className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px]"
                          >
                            <span className="min-w-0 truncate text-neutral-700">{section.name}</span>
                            <span className="shrink-0 text-[10px] text-subtle">
                              {section.task_count}タスク
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.sample_tasks.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-[11px] font-medium text-muted">
                        含まれるタスクの例
                      </h4>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {selected.sample_tasks.map((task, index) => (
                          <span
                            key={`${task}-${index}`}
                            className="rounded-full border border-neutral-200 bg-surface-subtle px-2 py-0.5 text-[10px] text-secondary"
                          >
                            {task}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <form
                  onSubmit={submit}
                  className="h-fit rounded-xl border border-neutral-200 bg-surface p-4"
                >
                  <h3 className="text-[13px] font-semibold text-neutral-800">
                    プロジェクトを作成
                  </h3>
                  <label className="mt-3 block text-[12px] font-medium text-neutral-700">
                    プロジェクト名
                    <input
                      data-project-create-name
                      autoFocus
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={200}
                      className="mt-1.5 w-full rounded-md border border-neutral-300 px-3 py-2 text-[13px] font-normal outline-none focus:border-[#4075cf] focus:ring-2 focus:ring-[#4075cf]/20"
                    />
                  </label>
                  <p className="mt-2 text-[10px] leading-5 text-subtle">
                    「{selected.name}」の{selected.section_count}セクション・
                    {selected.task_count}タスクを新しいプロジェクトにコピーします。期日は今日を基準に再設定されます。
                  </p>
                  {error !== "" && <p className="mt-2 text-[12px] text-danger">{error}</p>}
                  <button
                    type="submit"
                    data-project-create-submit
                    disabled={busy || name.trim() === ""}
                    className={`mt-3 w-full ${primary}`}
                  >
                    {busy ? "作成中…" : "テンプレートから作成"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openGallery()}
                    className="mt-2 w-full rounded-md px-3 py-1.5 text-[12px] text-muted hover:bg-neutral-50"
                  >
                    キャンセル
                  </button>
                </form>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
