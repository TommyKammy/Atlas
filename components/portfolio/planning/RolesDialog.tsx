"use client";

import { useEffect, useId, useRef, useState } from "react";
import { confirmAction } from "@/lib/ui-feedback";
import {
  buttonPrimary,
  buttonSecondary,
  FieldError,
  inputClass,
  labelClass,
  Notice,
} from "./ui";
import PlanningDialog from "./PlanningDialog";
import { planningErrorMessage } from "./errors";
import type { PlanningRole } from "@/lib/planning/types";

type RoleRow = { key: string; id: number | null; name: string };

export default function RolesDialog({
  open,
  onClose,
  roles,
  periodLabel,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  roles: PlanningRole[];
  periodLabel: string;
  onSave: (roles: { id: number | null; name: string }[]) => Promise<void>;
}) {
  const formId = useId();
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wasOpen = useRef(false);
  const nextKey = useRef(0);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setRows(roles.map((role) => ({ key: `role-${role.id}`, id: role.id, name: role.name })));
    setBusy(false);
    setError("");
  }, [open, roles]);

  const add = () => {
    nextKey.current += 1;
    setRows((current) => [...current, { key: `new-${nextKey.current}`, id: null, name: "" }]);
  };

  const remove = async (row: RoleRow) => {
    if (row.id !== null) {
      const role = roles.find((entry) => entry.id === row.id);
      const ok = await confirmAction(
        `職種「${role?.name ?? row.name}」を削除しますか？\nこの職種の配賦枠と案件別需要は、すべての四半期から削除されます。`,
        { title: "職種を削除", confirmLabel: "削除する" },
      );
      if (!ok) return;
    }
    setRows((current) => current.filter((entry) => entry.key !== row.key));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const names = new Set<string>();
    for (const row of rows) {
      const name = row.name.trim();
      if (name === "") {
        setError("職種名を入力してください");
        return;
      }
      if (name.length > 60) {
        setError("職種名は60文字以内で入力してください");
        return;
      }
      const normalized = name.toLocaleLowerCase("ja-JP");
      if (names.has(normalized)) {
        setError("同じ名前の職種が重複しています");
        return;
      }
      names.add(normalized);
    }
    const removed = roles.filter((role) => !rows.some((row) => row.id === role.id));
    if (removed.length > 0) {
      const ok = await confirmAction(
        `${removed.map((role) => `「${role.name}」`).join("、")}を削除します。\n配賦枠と案件別需要も削除されます。よろしいですか？`,
        { title: "職種を削除", confirmLabel: "削除して保存" },
      );
      if (!ok) return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(rows.map((row) => ({ id: row.id, name: row.name.trim() })));
    } catch (caught) {
      setError(planningErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PlanningDialog
      open={open}
      onClose={onClose}
      title="職種を管理"
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="submit" form={formId} className={buttonPrimary} disabled={busy}>
            {busy ? "保存中…" : "職種を保存"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-[12px] text-neutral-600">
          {periodLabel} の配賦枠と需要で使う職種です。職種はポートフォリオ全体で共有され、別の四半期にも引き継がれます。
        </p>
        <Notice tone="warn">
          職種を削除すると、その職種の配賦枠と案件別需要がすべての四半期から削除されます。採用済みの決定履歴は変更されません。
        </Notice>
        <div className="space-y-2">
          {rows.length === 0 && (
            <p className="rounded-md border border-dashed border-neutral-300 px-3 py-5 text-center text-[12px] text-neutral-500">
              職種がありません。「職種を追加」から登録してください。
            </p>
          )}
          {rows.map((row, index) => (
            <div key={row.key} className="flex items-end gap-2">
              <label className={`${labelClass} min-w-0 flex-1`}>
                職種 {index + 1}
                <input
                  value={row.name}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((entry) =>
                        entry.key === row.key ? { ...entry, name: event.target.value } : entry,
                      ),
                    )
                  }
                  className={`${inputClass} mt-1`}
                  maxLength={60}
                  autoFocus={index === 0 && row.id === null}
                />
              </label>
              <button
                type="button"
                onClick={() => void remove(row)}
                disabled={busy}
                aria-label={`${row.name || `職種 ${index + 1}`}を削除`}
                className="mb-0.5 inline-flex h-8 items-center rounded-md px-2 text-[12px] text-neutral-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
              >
                削除
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={add} className={buttonSecondary} disabled={busy || rows.length >= 30}>
          ＋ 職種を追加
        </button>
        {error && <FieldError>{error}</FieldError>}
      </form>
    </PlanningDialog>
  );
}
