"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api-client";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  CURRENCY_CHOICES,
  NUMBER_FORMAT_LABELS,
  formatNumberValue,
  normalizeCustomFieldConfig,
  type ColumnFunction,
  type CustomField,
  type CustomFieldType,
  type FieldAccessLevel,
  type NumberFormat,
} from "@/lib/custom-fields";
import { toast } from "@/lib/ui-feedback";

const TYPE_LABELS: Record<CustomFieldType, string> = {
  select: "単一選択",
  multi_select: "複数選択",
  text: "テキスト",
  number: "数値",
  date: "日付",
  people: "メンバー",
  auto_id: "ID",
  project: "プロジェクト",
  completed_on: "完了日",
  created_at: "作成日",
  modified_at: "最終変更日",
  created_by: "作成したユーザー",
  collaborators: "コラボレーター",
  attachments: "添付",
  blocked_by: "先行タスク",
  blocking: "後続を待たせている",
  formula: "数式",
  reference: "リファレンス",
  lookup: "ルックアップ",
  rollup: "集計",
  timer: "タイマー",
  time_tracking: "タイムトラッキング",
};

/** Asana-style create/edit dialog for a list custom field. */
export default function FieldDialog({
  projectId,
  mode,
  initialType,
  field,
  availableFields = [],
  users = [],
  onClose,
  onSaved,
}: {
  projectId: number;
  mode: "create" | "edit";
  initialType: CustomFieldType;
  field: CustomField | null;
  availableFields?: CustomField[];
  users?: { id: number; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<CustomFieldType>(field?.field_type ?? initialType);
  const [description, setDescription] = useState(field?.description ?? "");
  const [options, setOptions] = useState<string[]>(field?.options.length ? field.options : [""]);
  const [numberFormat, setNumberFormat] = useState<NumberFormat>(
    field?.config?.number_format ?? "number",
  );
  const [currency, setCurrency] = useState(field?.config?.currency ?? "JPY");
  const [decimals, setDecimals] = useState(field?.config?.decimals ?? 0);
  const [customSuffix, setCustomSuffix] = useState(field?.config?.custom_suffix ?? "");
  const [prefix, setPrefix] = useState(field?.config?.prefix ?? "ID-");
  const [expression, setExpression] = useState(field?.config?.expression ?? "");
  const [timerFormat, setTimerFormat] = useState<"hours_minutes" | "decimal_hours">(
    field?.config?.timer_format ?? "hours_minutes",
  );
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [sourceProjectIds, setSourceProjectIds] = useState<number[]>(
    field?.config?.source_project_ids ?? (initialType === "reference" ? [projectId] : []),
  );
  const [referenceFieldId, setReferenceFieldId] = useState<number | "">(
    field?.config?.reference_field_id ?? "",
  );
  const [lookupFieldId, setLookupFieldId] = useState<number | "">(
    field?.config?.lookup_field_id ?? "",
  );
  const [rollupSource, setRollupSource] = useState<"subtasks" | "reference">(
    field?.config?.rollup_source ?? "subtasks",
  );
  const [rollupFieldId, setRollupFieldId] = useState<number | "">(
    field?.config?.rollup_field_id ?? "",
  );
  const [rollupFunction, setRollupFunction] = useState<ColumnFunction>(
    field?.config?.rollup_function ?? "sum",
  );
  const [rollupReferenceFieldId, setRollupReferenceFieldId] = useState<number | "">(
    field?.config?.reference_field_id ?? "",
  );
  const [remoteFields, setRemoteFields] = useState<CustomField[]>([]);
  const [addToLibrary, setAddToLibrary] = useState(false);
  const [accessLevel, setAccessLevel] = useState<FieldAccessLevel>(field?.access_level ?? "everyone");
  const [editorIds, setEditorIds] = useState<number[]>(field?.editor_ids ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const config = useMemo(
    () =>
      normalizeCustomFieldConfig({
        number_format: numberFormat,
        currency,
        decimals,
        custom_suffix: customSuffix,
        column_function: field?.config?.column_function ?? "sum",
        include_subtasks: field?.config?.include_subtasks ?? false,
        expression,
        timer_format: timerFormat,
      }),
    [numberFormat, currency, decimals, customSuffix, field?.config, expression, timerFormat],
  );
  const preview = formatNumberValue(1000, config);
  const numberField = type === "number";
  const selectField = type === "select" || type === "multi_select";
  const autoIdField = type === "auto_id";
  const formulaField = type === "formula";
  const timerField = type === "timer";
  const timeTrackingField = type === "time_tracking";
  const numericFields = availableFields.filter(
    (item) => item.id !== field?.id && (item.field_type === "number" || item.field_type === "formula"),
  );
  const referenceFields = availableFields.filter((item) => item.field_type === "reference");
  const lookupSourceRefId = type === "lookup" ? referenceFieldId : rollupReferenceFieldId;
  const lookupSourceField = availableFields.find((item) => item.id === lookupSourceRefId);

  useEffect(() => {
    if (type !== "reference" && type !== "lookup" && type !== "rollup") return;
    let cancelled = false;
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: { id: number; name: string }[]) => {
        if (!cancelled) setProjects(Array.isArray(rows) ? rows : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [type]);

  const lookupSourceKey = (lookupSourceField?.config?.source_project_ids ?? []).join(",");

  useEffect(() => {
    if (lookupSourceKey === "") return;
    const sourceIds = lookupSourceKey.split(",").map(Number);
    let cancelled = false;
    Promise.all(
      sourceIds.map((id) =>
        fetch(`/api/custom-fields?project_id=${id}`)
          .then((res) => (res.ok ? res.json() : []))
          .catch(() => []),
      ),
    ).then((groups: CustomField[][]) => {
      if (cancelled) return;
      const merged: CustomField[] = [];
      const seen = new Set<number>();
      for (const group of groups) {
        for (const item of group) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          merged.push(item);
        }
      }
      setRemoteFields(merged);
    });
    return () => {
      cancelled = true;
    };
  }, [lookupSourceKey]);

  const updateOption = (index: number, value: string) => {
    setOptions((current) => current.map((item, i) => (i === index ? value : item)));
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("フィールドタイトルを入力してください");
      return;
    }
    if (type === "reference" && sourceProjectIds.length === 0) {
      setError("参照元のプロジェクトを1つ以上選択してください");
      return;
    }
    if (type === "lookup" && (referenceFieldId === "" || lookupFieldId === "")) {
      setError("参照フィールドとルックアップするフィールドを選択してください");
      return;
    }
    if (
      type === "rollup" &&
      (rollupFieldId === "" || (rollupSource === "reference" && rollupReferenceFieldId === ""))
    ) {
      setError("集計元のフィールドを選択してください");
      return;
    }
    setSaving(true);
    setError("");
    let specialConfig: Record<string, unknown> = {};
    if (type === "reference") {
      specialConfig = { source_project_ids: sourceProjectIds };
    } else if (type === "lookup") {
      specialConfig = {
        reference_field_id: Number(referenceFieldId),
        lookup_field_id: Number(lookupFieldId),
      };
    } else if (type === "rollup") {
      specialConfig = {
        rollup_source: rollupSource,
        rollup_field_id: Number(rollupFieldId),
        rollup_function: rollupFunction,
        ...(rollupSource === "reference"
          ? { reference_field_id: Number(rollupReferenceFieldId) }
          : {}),
      };
    }
    const body = {
      name: trimmed,
      field_type: type,
      description: description.trim(),
      options: selectField ? options.map((option) => option.trim()).filter((option) => option !== "") : [],
      config:
        numberField || formulaField
          ? config
          : autoIdField
            ? { prefix: prefix.trim() || "ID-" }
            : timerField
              ? { timer_format: timerFormat }
              : specialConfig,
      access_level: accessLevel,
      editor_ids: accessLevel === "custom" ? editorIds : [],
    };
    try {
      if (mode === "edit" && field) {
        await api(`/api/custom-fields/${field.id}`, "PATCH", {
          name: body.name,
          description: body.description,
          options: body.options,
          config: body.config,
          access_level: body.access_level,
          editor_ids: body.editor_ids,
        });
      } else {
        await api("/api/custom-fields", "POST", { project_id: projectId, ...body });
        if (addToLibrary) {
          await api("/api/field-library", "POST", {
            project_id: projectId,
            name: body.name,
            field_type: body.field_type,
            options: body.options,
            description: body.description,
            config: body.config,
          });
        }
      }
      onSaved();
      onClose();
    } catch (saveError) {
      setError(`保存に失敗しました: ${saveError instanceof Error ? saveError.message : saveError}`);
      toast("フィールドを保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const label = "mt-3 block text-[11px] font-medium text-neutral-500";
  const fieldClass =
    "mt-1 h-9 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-[13px] text-neutral-800 outline-none focus:border-[#4075cf] focus:ring-2 focus:ring-[#4075cf]/10";

  return createPortal(
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center bg-black/35 p-4"
      onClick={onClose}
      data-field-dialog
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "フィールドを編集" : "フィールドを追加"}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <div>
            <h2 className="text-[17px] font-semibold text-neutral-900">
              {mode === "edit" ? "フィールドを編集" : "フィールドを追加"}
            </h2>
            {mode === "edit" && field && (
              <div className="mt-0.5 text-[10px] text-neutral-400">フィールドタイプは変更できません</div>
            )}
          </div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="rounded p-1 text-xl leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="block text-[11px] font-medium text-neutral-500">
            フィールドタイトル <span className="text-red-500">*</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={numberField ? "費用、数量、売上…" : "フィールド名"}
              data-field-dialog-name
              className={fieldClass}
            />
          </label>

          <label className={label}>
            フィールドタイプ
            {mode === "edit" ? (
              <div className="mt-1 flex h-9 items-center rounded-md border border-neutral-200 bg-neutral-50 px-2.5 text-[13px] text-neutral-600">
                {TYPE_LABELS[type]}
              </div>
            ) : (
              <select
                value={type}
                onChange={(event) => {
                  const nextType = event.target.value as CustomFieldType;
                  setType(nextType);
                  if (nextType === "reference" && sourceProjectIds.length === 0) {
                    setSourceProjectIds([projectId]);
                  }
                }}
                className={fieldClass}
              >
                <option value="select">単一選択</option>
                <option value="multi_select">複数選択</option>
                <option value="date">日付</option>
                <option value="people">メンバー</option>
                <option value="text">テキスト</option>
                <option value="number">数値</option>
                <option value="formula">数式</option>
                <option value="reference">リファレンス</option>
                <option value="lookup">ルックアップ</option>
                <option value="rollup">集計</option>
                <option value="timer">タイマー</option>
                <option value="time_tracking">タイムトラッキング</option>
                <option value="auto_id">ID</option>
                <option value="project">プロジェクト</option>
                <option value="completed_on">完了日</option>
                <option value="modified_at">最終変更日</option>
                <option value="created_at">作成日</option>
                <option value="created_by">作成したユーザー</option>
                <option value="collaborators">コラボレーター</option>
                <option value="attachments">添付</option>
                <option value="blocked_by">先行タスク</option>
                <option value="blocking">後続を待たせている</option>
              </select>
            )}
          </label>

          <label className={label}>
            説明
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="説明を追加（任意）"
              className="mt-1 w-full resize-y rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-[13px] outline-none focus:border-[#4075cf] focus:ring-2 focus:ring-[#4075cf]/10"
            />
          </label>

          {numberField && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">数値の表示</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-neutral-500">
                  フォーマット
                  <select
                    value={numberFormat}
                    onChange={(event) => setNumberFormat(event.target.value as NumberFormat)}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    {Object.entries(NUMBER_FORMAT_LABELS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-neutral-500">
                  小数桁数
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={decimals}
                    onChange={(event) =>
                      setDecimals(Math.max(0, Math.min(6, Number(event.target.value) || 0)))
                    }
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  />
                </label>
                {numberFormat === "currency" && (
                  <label className="text-[11px] text-neutral-500">
                    通貨
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    >
                      {CURRENCY_CHOICES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {numberFormat === "custom" && (
                  <label className="text-[11px] text-neutral-500">
                    ラベル
                    <input
                      value={customSuffix}
                      onChange={(event) => setCustomSuffix(event.target.value)}
                      placeholder="例: lbs"
                      className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    />
                  </label>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                <span>例</span>
                <span className="font-medium text-neutral-700">{preview}</span>
              </div>
              <div className="mt-1 text-[10px] text-neutral-400">
                セクション合計は列メニューの「列の関数」から変更できます。
              </div>
            </div>
          )}

          {timerField && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">タイマー</div>
              <label className="mt-2 block text-[11px] text-neutral-500">
                フォーマット
                <select
                  value={timerFormat}
                  onChange={(event) =>
                    setTimerFormat(event.target.value === "decimal_hours" ? "decimal_hours" : "hours_minutes")
                  }
                  className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                >
                  <option value="hours_minutes">00 時間 00 分</option>
                  <option value="decimal_hours">0.00 時間</option>
                </select>
              </label>
              <div className="mt-1 text-[10px] text-neutral-400">
                セルまたはタスク詳細の ▶ で計測を開始し、■ で停止します。
              </div>
            </div>
          )}

          {timeTrackingField && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">タイムトラッキング</div>
              <div className="mt-1 text-[10px] text-neutral-400">
                このタスクのすべてのタイマーの合計時間を表示します。値は自動計算されます。
              </div>
            </div>
          )}

          {type === "reference" && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">参照元のプロジェクト</div>
              <div className="mt-1 text-[10px] text-neutral-400">
                このフィールドからリンクできるタスクのプロジェクトを選択します。
              </div>
              <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                {projects.map((project) => (
                  <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12px] text-neutral-700 hover:bg-white">
                    <input
                      type="checkbox"
                      checked={sourceProjectIds.includes(project.id)}
                      onChange={(event) =>
                        setSourceProjectIds((current) =>
                          event.target.checked
                            ? [...current, project.id]
                            : current.filter((id) => id !== project.id),
                        )
                      }
                    />
                    <span className="truncate">{project.name}</span>
                  </label>
                ))}
                {projects.length === 0 && <div className="px-1 py-2 text-[11px] text-neutral-400">プロジェクトを読み込み中…</div>}
              </div>
            </div>
          )}

          {type === "lookup" && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">ルックアップ</div>
              <label className="mt-2 block text-[11px] text-neutral-500">
                参照フィールド
                <select
                  value={referenceFieldId}
                  onChange={(event) => {
                    setReferenceFieldId(event.target.value === "" ? "" : Number(event.target.value));
                    setLookupFieldId("");
                    setRemoteFields([]);
                  }}
                  className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                >
                  <option value="">選択してください</option>
                  {referenceFields.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-2 block text-[11px] text-neutral-500">
                参照先で取得するフィールド
                <select
                  value={lookupFieldId}
                  onChange={(event) => setLookupFieldId(event.target.value === "" ? "" : Number(event.target.value))}
                  className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                >
                  <option value="">選択してください</option>
                  {remoteFields
                    .filter((item) => item.id !== field?.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              {referenceFields.length === 0 && (
                <div className="mt-1 text-[10px] text-amber-600">
                  先にリファレンスフィールドを作成してください。
                </div>
              )}
            </div>
          )}

          {type === "rollup" && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">集計</div>
              <label className="mt-2 block text-[11px] text-neutral-500">
                集計元
                <select
                  value={rollupSource}
                  onChange={(event) => {
                    setRollupSource(event.target.value === "reference" ? "reference" : "subtasks");
                    setRollupFieldId("");
                  }}
                  className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                >
                  <option value="subtasks">サブタスク</option>
                  <option value="reference">リファレンス先のタスク</option>
                </select>
              </label>
              {rollupSource === "reference" && (
                <label className="mt-2 block text-[11px] text-neutral-500">
                  参照フィールド
                  <select
                    value={rollupReferenceFieldId}
                    onChange={(event) => {
                      setRollupReferenceFieldId(event.target.value === "" ? "" : Number(event.target.value));
                      setRollupFieldId("");
                      setRemoteFields([]);
                    }}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    <option value="">選択してください</option>
                    {referenceFields.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-neutral-500">
                  集計するフィールド
                  <select
                    value={rollupFieldId}
                    onChange={(event) => setRollupFieldId(event.target.value === "" ? "" : Number(event.target.value))}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    <option value="">選択してください</option>
                    {(rollupSource === "subtasks" ? numericFields.filter((item) => item.field_type === "number") : remoteFields.filter((item) => item.field_type === "number")).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-neutral-500">
                  関数
                  <select
                    value={rollupFunction}
                    onChange={(event) => setRollupFunction(event.target.value as ColumnFunction)}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    <option value="sum">合計</option>
                    <option value="average">平均</option>
                    <option value="count">個数</option>
                    <option value="min">最小値</option>
                    <option value="max">最大値</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {formulaField && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">数式</div>
              <label className="mt-2 block text-[11px] text-neutral-500">
                計算式
                <input
                  value={expression}
                  onChange={(event) => setExpression(event.target.value.slice(0, 500))}
                  placeholder="例: {123} + {124}"
                  data-field-dialog-expression
                  className="mt-1 h-9 w-full rounded border border-neutral-300 bg-white px-2 font-mono text-[12px] outline-none focus:border-[#4075cf]"
                />
              </label>
              {numericFields.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] text-neutral-400">フィールドを選択（クリックで挿入）</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {numericFields.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setExpression((current) => `${current}${current && !/[+\-*/^(]$/.test(current.trim()) ? " + " : ""}{${item.id}}`)}
                        className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] text-neutral-600 hover:bg-blue-50"
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-neutral-500">
                  フォーマット
                  <select
                    value={numberFormat}
                    onChange={(event) => setNumberFormat(event.target.value as NumberFormat)}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    {Object.entries(NUMBER_FORMAT_LABELS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-neutral-500">
                  小数桁数
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={decimals}
                    onChange={(event) =>
                      setDecimals(Math.max(0, Math.min(6, Number(event.target.value) || 0)))
                    }
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  />
                </label>
                {numberFormat === "currency" && (
                  <label className="text-[11px] text-neutral-500">
                    通貨
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    >
                      {CURRENCY_CHOICES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div className="mt-1 text-[10px] text-neutral-400">
                四則演算・括弧・SUM/AVG/MIN/MAX/ROUND/ABS が使えます。空欄の数値フィールドがある場合は「–」になります。
              </div>
            </div>
          )}

          {autoIdField && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">IDの自動採番</div>
              <label className="mt-2 block text-[11px] text-neutral-500">
                プレフィックス
                <input
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value.slice(0, 16))}
                  placeholder="ID-"
                  data-field-dialog-prefix
                  className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                />
              </label>
              <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                <span>例</span>
                <span className="font-medium text-neutral-700">{`${prefix.trim() || "ID-"}1`}</span>
              </div>
              <div className="mt-1 text-[10px] text-neutral-400">
                タスクごとに連番で自動採番されます。値は編集できません。
              </div>
            </div>
          )}

          {selectField && (
            <div className="mt-4">
              <div className="text-[11px] font-medium text-neutral-500">選択肢</div>
              <div className="mt-1 space-y-1">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <input
                      value={option}
                      onChange={(event) => updateOption(index, event.target.value)}
                      placeholder={`選択肢 ${index + 1}`}
                      className="h-8 min-w-0 flex-1 rounded border border-neutral-300 px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    />
                    <button
                      type="button"
                      onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                      className="rounded px-1.5 text-[12px] text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                      aria-label="選択肢を削除"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setOptions((current) => [...current, ""])}
                className="mt-1 rounded px-1.5 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
              >
                ＋ 選択肢を追加
              </button>
            </div>
          )}

          {mode === "create" && (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-neutral-600">
              <input
                type="checkbox"
                checked={addToLibrary}
                onChange={(event) => setAddToLibrary(event.target.checked)}
              />
              このフィールドをライブラリに追加する
            </label>
          )}

          <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-3">
            <div className="text-[12px] font-semibold text-neutral-700">フィールドアクセスと権限</div>
            <label className="mt-2 block text-[11px] text-neutral-500">
              このフィールドの値を編集できるユーザー
              <select
                value={accessLevel}
                onChange={(event) => setAccessLevel(event.target.value as FieldAccessLevel)}
                data-field-access-level
                className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
              >
                <option value="everyone">すべてのプロジェクトメンバー</option>
                <option value="admins">プロジェクト管理者のみ</option>
                <option value="custom">特定のユーザー</option>
              </select>
            </label>
            {accessLevel === "custom" && (
              <div className="mt-2 max-h-36 space-y-0.5 overflow-y-auto rounded border border-neutral-100 p-1.5">
                {users.map((user) => (
                  <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12px] text-neutral-700 hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      checked={editorIds.includes(user.id)}
                      onChange={(event) =>
                        setEditorIds((current) =>
                          event.target.checked
                            ? [...current, user.id]
                            : current.filter((id) => id !== user.id),
                        )
                      }
                    />
                    <span className="truncate">{user.name}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-1 text-[10px] text-neutral-400">
              フィールド設定の変更はプロジェクト編集権限を持つユーザーが行えます。
            </div>
          </div>

          {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-100"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || name.trim() === ""}
            data-field-dialog-save
            className="rounded-md bg-[#2f6fd0] px-4 py-1.5 text-[12px] font-medium text-white hover:bg-[#2459ad] disabled:bg-neutral-200 disabled:text-neutral-500"
          >
            {saving
              ? "保存中…"
              : mode === "edit"
                ? "変更内容を保存"
                : "フィールドを作成"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
