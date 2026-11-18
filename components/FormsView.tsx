"use client";

import { ProjectViewToolbar, ViewAddButton } from "@/components/view/ProjectViewToolbar";
import { confirmAction } from "@/lib/ui-feedback";

import { useEffect, useId, useRef, useState } from "react";
import type { FormField, FormFieldType, ProjectForm } from "@/lib/forms";
import { DEFAULT_FORM_FIELDS, FORM_FIELD_TYPES } from "@/lib/forms";
import { useApiRefresh } from "@/lib/use-api-refresh";
import Dialog from "./ui/Dialog";
import EmptyState from "./EmptyState";

type Builder = {
  id: number | null;
  name: string;
  description: string;
  fields: FormField[];
};

function cloneDefaults(): FormField[] {
  return DEFAULT_FORM_FIELDS.map((field) => ({ ...field, options: [...field.options] }));
}

export default function FormsView({
  projectId,
  initial,
  canConfigure = true,
}: {
  projectId: number;
  initial: ProjectForm[];
  canConfigure?: boolean;
}) {
  const refresh = useApiRefresh();
  const formId = useId();
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [builder, setBuilder] = useState<Builder | null>(null);
  const [answering, setAnswering] = useState<ProjectForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const builderRef = useRef<HTMLFormElement>(null);
  const answerRef = useRef<HTMLFormElement>(null);
  const errorFormRef = builder ? builderRef : answerRef;
  useEffect(() => {
    if (!error) return;
    const form = errorFormRef.current;
    const field = invalidField ? form?.elements.namedItem(invalidField) : null;
    if (field instanceof HTMLElement) field.focus();
    else form?.querySelector<HTMLElement>("[data-form-error]")?.focus();
  }, [error, invalidField, errorFormRef]);

  const clearError = (event: React.FormEvent<HTMLFormElement>) => {
    const control = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (invalidField && control.name !== invalidField) return;
    setError("");
    setInvalidField(null);
  };

  const startCreate = () => {
    if (!canConfigure) return;
    setError("");
    setMessage("");
    setBuilder({ id: null, name: "", description: "", fields: cloneDefaults() });
  };

  const startEdit = (form: ProjectForm) => {
    if (!canConfigure) return;
    setError("");
    setMessage("");
    setBuilder({
      id: form.id,
      name: form.name,
      description: form.description,
      fields: form.fields.map((field) => ({ ...field, options: [...field.options] })),
    });
  };

  const updateField = (index: number, patch: Partial<FormField>) => {
    if (!builder) return;
    setBuilder({
      ...builder,
      fields: builder.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!builder || busy) return;
    if (!builder.name.trim()) {
      setInvalidField("form-name");
      setError("フォーム名を入力してください");
      return;
    }
    const missingLabel = builder.fields.findIndex((field) => !field.label.trim());
    if (missingLabel !== -1) {
      setInvalidField(`field-${missingLabel}-label`);
      setError("すべての項目にラベルを入力してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(builder.id === null ? "/api/forms" : `/api/forms/${builder.id}`, {
        method: builder.id === null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(builder.id === null ? { project_id: projectId } : {}),
          name: builder.name.trim(),
          description: builder.description.trim(),
          fields: builder.fields,
        }),
      });
      if (!res.ok) throw new Error(`保存に失敗しました (${res.status})`);
      setBuilder(null);
      setMessage(builder.id === null ? "フォームを作成しました" : "フォームを更新しました");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async (form: ProjectForm) => {
    const res = await fetch(`/api/forms/${form.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !form.published }),
    });
    if (!res.ok) {
      setError(`公開状態の変更に失敗しました (${res.status})`);
      return;
    }
    setMessage(form.published ? "フォームを非公開にしました" : "フォームを公開しました");
    refresh();
  };

  const remove = async (form: ProjectForm) => {
    if (!await confirmAction(`「${form.name}」フォームを削除しますか？`)) return;
    const res = await fetch(`/api/forms/${form.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(`削除に失敗しました (${res.status})`);
      return;
    }
    setMessage("フォームを削除しました");
    refresh();
  };

  const openAnswer = (form: ProjectForm) => {
    setAnswers({});
    setError("");
    setInvalidField(null);
    setAnswering(form);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!answering || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/forms/${answering.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInvalidField(typeof data.field === "string" ? data.field : null);
        throw new Error(data.error ?? `送信に失敗しました (${res.status})`);
      }
      setAnswering(null);
      setMessage("回答を送信し、タスクを作成しました");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-forms className="max-w-4xl px-4 pb-16">
      <ProjectViewToolbar>
        <ViewAddButton data-form-new disabled={!canConfigure} onClick={startCreate}>フォームを作成</ViewAddButton>
      </ProjectViewToolbar>
      <p className="mt-4 text-[13px] text-muted">
        入力フォームから回答を受け取り、プロジェクトにタスクを自動で作成します。
      </p>

      {message && (
        <p role="status" className="mt-3 rounded-md border border-success-line bg-success-soft px-3 py-2 text-[13px] text-success">
          {message}
        </p>
      )}
      {error && !builder && !answering && (
        <p role="alert" className="mt-3 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {initial.length === 0 ? (
          <EmptyState
            scope="forms"
            title="フォームで intake を自動化"
            description="問い合わせや依頼の項目を定義し、回答からタスクを作成できます。"
          />
        ) : (
          initial.map((form) => (
            <article
              key={form.id}
              data-form-card={form.id}
              className="rounded-lg border border-line bg-surface p-4"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold text-text">{form.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        form.published
                          ? "bg-success-soft text-success"
                          : "bg-surface-muted text-muted"
                      }`}
                    >
                      {form.published ? "公開中" : "下書き"}
                    </span>
                  </div>
                  {form.description && (
                    <p className="mt-1 text-[13px] text-secondary">{form.description}</p>
                  )}
                  <div className="mt-1 text-[11px] text-muted">
                    {form.fields.length} 項目 ・ 回答 {form.response_count} 件
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  <button
                    type="button"
                    data-form-publish={form.id}
                    disabled={!canConfigure}
                    onClick={() => void togglePublish(form)}
                    className="h-7 rounded-md border border-line px-2 text-[12px] text-secondary hover:bg-hover"
                  >
                    {form.published ? "非公開" : "公開"}
                  </button>
                  <button
                    type="button"
                    data-form-answer={form.id}
                    disabled={!form.published}
                    onClick={() => openAnswer(form)}
                    className="h-7 rounded-md bg-accent-soft px-2 text-[12px] font-medium text-accent-text hover:bg-accent-soft-hover disabled:opacity-40"
                  >
                    回答
                  </button>
                  <button
                    type="button"
                    data-form-edit={form.id}
                    disabled={!canConfigure}
                    aria-label={`${form.name}を編集`}
                    onClick={() => startEdit(form)}
                    className="flex h-7 w-7 items-center justify-center rounded text-subtle hover:bg-hover hover:text-secondary"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <path d="m10.5 2.5 3 3L6 13H3v-3z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    data-form-delete={form.id}
                    disabled={!canConfigure}
                    aria-label={`${form.name}を削除`}
                    onClick={() => void remove(form)}
                    className="flex h-7 w-7 items-center justify-center rounded text-subtle hover:bg-danger-soft hover:text-danger"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8h5.8l.6-8M6.5 7v3M9.5 7v3" />
                    </svg>
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {builder && (
        <Dialog open onClose={() => setBuilder(null)} titleId={`${formId}-builder-title`} panelClassName="w-[min(560px,94vw)] rounded-lg bg-surface">
          <form
            ref={builderRef}
            tabIndex={-1}
            onSubmit={save}
            onInput={clearError}
            data-form-builder
            className="max-h-[80vh] w-full overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 id={`${formId}-builder-title`} className="text-[15px] font-semibold text-text">
                {builder.id === null ? "フォームを作成" : "フォームを編集"}
              </h2>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setBuilder(null)}
                className="text-lg leading-none text-subtle hover:text-secondary"
              >
                ×
              </button>
            </div>
            <label className="mt-4 block text-[12px] font-medium text-secondary">
              フォーム名
              <input
                name="form-name"
                required
                aria-invalid={invalidField === "form-name" || undefined}
                aria-describedby={invalidField === "form-name" ? `${formId}-builder-error` : undefined}
                value={builder.name}
                onChange={(event) => setBuilder({ ...builder, name: event.target.value })}
                data-form-name
                placeholder="例: 問い合わせフォーム"
                className="mt-1 h-8 w-full rounded-md border border-line px-2 text-[13px] outline-none focus:border-accent"
              />
            </label>
            <label className="mt-3 block text-[12px] font-medium text-secondary">
              説明
              <textarea
                value={builder.description}
                onChange={(event) => setBuilder({ ...builder, description: event.target.value })}
                data-form-description
                rows={2}
                className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-[13px] outline-none focus:border-accent"
              />
            </label>

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-text">入力項目</h3>
                <button
                  type="button"
                  data-form-add-field
                  onClick={() =>
                    setBuilder({
                      ...builder,
                      fields: [
                        ...builder.fields,
                        {
                          key: `field_${Date.now()}_${builder.fields.length}`,
                          label: "",
                          type: "text",
                          required: false,
                          options: [],
                        },
                      ],
                    })
                  }
                  className="text-[12px] text-accent-text hover:underline"
                >
                  ＋ 項目を追加
                </button>
              </div>
              {builder.fields.map((field, index) => (
                <div key={`${field.key}-${index}`} data-form-field={index} className="rounded-md border border-line p-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      name={`field-${index}-label`}
                      required
                      aria-label={`項目${index + 1}の名前`}
                      aria-invalid={invalidField === `field-${index}-label` || undefined}
                      aria-describedby={invalidField === `field-${index}-label` ? `${formId}-builder-error` : undefined}
                      value={field.label}
                      onChange={(event) => updateField(index, { label: event.target.value })}
                      data-form-field-label={index}
                      placeholder={index === 0 ? "タスク名" : "項目名"}
                      className="h-7 min-w-0 flex-1 rounded border border-line px-2 text-[13px] outline-none focus:border-accent"
                    />
                    <select
                      value={field.type}
                      disabled={index === 0}
                      onChange={(event) =>
                        updateField(index, {
                          type: event.target.value as FormFieldType,
                          options: event.target.value === "select" ? field.options : [],
                        })
                      }
                      data-form-field-type={index}
                      className="h-7 rounded border border-line bg-field px-1 text-[12px] disabled:bg-surface-muted"
                    >
                      {FORM_FIELD_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                    {index > 0 && (
                      <label className="flex items-center gap-1 text-[11px] text-secondary">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) => updateField(index, { required: event.target.checked })}
                          data-form-field-required={index}
                          className="h-3 w-3 accent-accent"
                        />
                        必須
                      </label>
                    )}
                    {index > 0 && (
                      <button
                        type="button"
                        aria-label="項目を削除"
                        data-form-field-remove={index}
                        onClick={() =>
                          setBuilder({
                            ...builder,
                            fields: builder.fields.filter((_, i) => i !== index),
                          })
                        }
                        className="text-subtle hover:text-danger"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {field.type === "select" && index > 0 && (
                    <input
                      value={field.options.join(", ")}
                      onChange={(event) =>
                        updateField(index, {
                          options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean),
                        })
                      }
                      data-form-field-options={index}
                      placeholder="選択肢をカンマ区切り（例: 高, 中, 低）"
                      className="mt-2 h-7 w-full rounded border border-line px-2 text-[12px] outline-none focus:border-accent"
                    />
                  )}
                </div>
              ))}
            </div>
            {error && <p id={`${formId}-builder-error`} role="alert" tabIndex={-1} data-form-error className="mt-3 text-[12px] text-danger">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBuilder(null)}
                className="rounded px-3 py-1.5 text-[13px] text-muted hover:bg-hover"
              >
                キャンセル
              </button>
              <button
                type="submit"
                data-form-save
                disabled={busy}
                className="rounded bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {answering && (
        <Dialog open onClose={() => setAnswering(null)} titleId={`${formId}-answer-heading`} panelClassName="w-[min(520px,94vw)] rounded-lg bg-surface">
          <form
            ref={answerRef}
            tabIndex={-1}
            onSubmit={submit}
            onInput={clearError}
            data-form-answer-form
            className="max-h-[80vh] w-full overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 id={`${formId}-answer-heading`} className="text-[15px] font-semibold text-text">{answering.name}</h2>
                {answering.description && (
                  <p className="mt-0.5 text-[12px] text-muted">{answering.description}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setAnswering(null)}
                className="text-lg leading-none text-subtle hover:text-secondary"
              >
                ×
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {answering.fields.map((field) => (
                <label key={field.key} htmlFor={`${formId}-answer-field-${field.key}`} className="block text-[12px] font-medium text-secondary">
                  {field.label}
                  {field.required && <span className="ml-1 text-danger">*</span>}
                  {field.type === "textarea" ? (
                    <textarea
                      id={`${formId}-answer-field-${field.key}`}
                      name={field.key}
                      required={field.required}
                      aria-invalid={invalidField === field.key || undefined}
                      aria-describedby={invalidField === field.key ? `${formId}-answer-error` : undefined}
                      value={answers[field.key] ?? ""}
                      onChange={(event) => setAnswers({ ...answers, [field.key]: event.target.value })}
                      data-form-answer-input={field.key}
                      rows={3}
                      className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-[13px] outline-none focus:border-accent"
                    />
                  ) : field.type === "select" ? (
                    <select
                      id={`${formId}-answer-field-${field.key}`}
                      name={field.key}
                      required={field.required}
                      aria-invalid={invalidField === field.key || undefined}
                      aria-describedby={invalidField === field.key ? `${formId}-answer-error` : undefined}
                      value={answers[field.key] ?? ""}
                      onChange={(event) => setAnswers({ ...answers, [field.key]: event.target.value })}
                      data-form-answer-input={field.key}
                      className="mt-1 h-8 w-full rounded-md border border-line bg-field px-2 text-[13px] outline-none focus:border-accent"
                    >
                      <option value="">選択してください</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                      id={`${formId}-answer-field-${field.key}`}
                      name={field.key}
                      required={field.required}
                      aria-invalid={invalidField === field.key || undefined}
                      aria-describedby={invalidField === field.key ? `${formId}-answer-error` : undefined}
                      value={answers[field.key] ?? ""}
                      onChange={(event) => setAnswers({ ...answers, [field.key]: event.target.value })}
                      data-form-answer-input={field.key}
                      className="mt-1 h-8 w-full rounded-md border border-line px-2 text-[13px] outline-none focus:border-accent"
                    />
                  )}
                </label>
              ))}
            </div>
            {error && <p id={`${formId}-answer-error`} role="alert" tabIndex={-1} data-form-error className="mt-3 text-[12px] text-danger">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAnswering(null)}
                className="rounded px-3 py-1.5 text-[13px] text-muted hover:bg-hover"
              >
                キャンセル
              </button>
              <button
                type="submit"
                data-form-submit
                disabled={busy}
                className="rounded bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                送信
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
