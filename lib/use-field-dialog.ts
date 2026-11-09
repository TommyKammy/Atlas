"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import {
  formatNumberValue,
  isLookupTargetFieldType,
  normalizeCustomFieldConfig,
  type ColumnFunction,
  type CustomField,
  type CustomFieldType,
  type FieldAccessLevel,
  type NumberFormat,
} from "./custom-fields";
import { toast } from "./ui-feedback";

/** State and persistence for the custom-field create/edit dialog. */
export function useFieldDialog({
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
    (item) =>
      item.id !== field?.id &&
      (item.field_type === "number" || item.field_type === "rollup"),
  );
  const lookupTargetFields = remoteFields.filter(
    (item) => item.id !== field?.id && isLookupTargetFieldType(item.field_type),
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
    if (accessLevel === "custom" && editorIds.length === 0) {
      setError("特定のユーザーを1人以上選択してください");
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
        column_function: field?.config?.column_function ?? "sum",
        include_subtasks: field?.config?.include_subtasks ?? false,
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
          try {
            await api("/api/field-library", "POST", {
              project_id: projectId,
              name: body.name,
              field_type: body.field_type,
              options: body.options,
              description: body.description,
              config: body.config,
            });
          } catch {
            toast("フィールドは作成しましたが、ライブラリへの追加に失敗しました");
          }
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

  return {
    name,
    setName,
    type,
    setType,
    description,
    setDescription,
    options,
    setOptions,
    numberFormat,
    setNumberFormat,
    currency,
    setCurrency,
    decimals,
    setDecimals,
    customSuffix,
    setCustomSuffix,
    prefix,
    setPrefix,
    expression,
    setExpression,
    timerFormat,
    setTimerFormat,
    projects,
    sourceProjectIds,
    setSourceProjectIds,
    referenceFieldId,
    setReferenceFieldId,
    lookupFieldId,
    setLookupFieldId,
    rollupSource,
    setRollupSource,
    rollupFieldId,
    setRollupFieldId,
    rollupFunction,
    setRollupFunction,
    rollupReferenceFieldId,
    setRollupReferenceFieldId,
    remoteFields,
    setRemoteFields,
    addToLibrary,
    setAddToLibrary,
    accessLevel,
    setAccessLevel,
    editorIds,
    setEditorIds,
    saving,
    error,
    config,
    preview,
    numberField,
    selectField,
    autoIdField,
    formulaField,
    timerField,
    timeTrackingField,
    numericFields,
    lookupTargetFields,
    referenceFields,
    users,
    save,
    updateOption,
  };
}

export type FieldDialogState = ReturnType<typeof useFieldDialog>;
