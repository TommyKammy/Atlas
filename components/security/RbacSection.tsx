"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmAction } from "@/lib/ui-feedback";
import { api } from "@/lib/api-client";
import { PERMISSION_CATALOG, type Permission } from "@/lib/permission-catalog";
import type { AdminRole } from "@/lib/admin-data";
import { SectionHeader, field } from "./SectionHeader";

const BASE_LABEL: Record<AdminRole["base_level"], string> = {
  admin: "管理者",
  member: "メンバー",
  guest: "ゲスト",
};

const BASE_LEVEL_HINT: Record<AdminRole["base_level"], string> = {
  admin: "管理コンソールへのアクセスを含む役割です",
  member: "通常のワークスペースメンバーです",
  guest: "外部コラボレーター向けの限定アクセスです",
};

const MEMBER_ONLY: Permission[] = ["projects.create", "tasks.create"];

export function RbacSection({ initialRoles }: { initialRoles: AdminRole[] }) {
  const router = useRouter();
  const [roles, setRoles] = useState(initialRoles);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRole | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseLevel, setBaseLevel] = useState<AdminRole["base_level"]>("member");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setBaseLevel("member");
    setPermissions(["projects.create", "tasks.create"]);
    setMsg("");
    setOpen(true);
  };

  const openEdit = (role: AdminRole) => {
    setEditing(role);
    setName(role.name);
    setDescription(role.description);
    setBaseLevel(role.base_level);
    setPermissions(role.permissions);
    setMsg("");
    setOpen(true);
  };

  const togglePermission = (permission: Permission) => {
    setPermissions((prev) =>
      prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission],
    );
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    const payload = { name, description, base_level: baseLevel, permissions };
    try {
      const data = editing
        ? await api<{ roles: AdminRole[] }>(`/api/admin/roles/${editing.id}`, "PATCH", payload)
        : await api<{ roles: AdminRole[] }>("/api/admin/roles", "POST", payload);
      setRoles(data.roles);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setMsg(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (role: AdminRole) => {
    if (!(await confirmAction(`役割「${role.name}」を削除しますか？`))) return;
    try {
      const data = await api<{ roles: AdminRole[] }>(`/api/admin/roles/${role.id}`, "DELETE");
      setRoles(data.roles);
      router.refresh();
    } catch (e) {
      setMsg(`削除に失敗しました: ${e instanceof Error ? e.message : e}`);
    }
  };

  const allowedPermissions = baseLevel === "admin"
    ? PERMISSION_CATALOG.map((entry) => entry.key)
    : MEMBER_ONLY;

  return (
    <div data-security-section="rbac">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="ロールベースのアクセス制御 (RBAC)"
          description="役割を管理し、権限を設定することで、ユーザーが Atlas で行えることを制御できます。"
        />
        <button
          onClick={openCreate}
          data-role-create
          className="rounded bg-accent px-3 py-1.5 text-sm text-on-accent hover:bg-accent-hover"
        >
          役割を作成
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(220px,1.4fr)_120px_130px_120px_120px] gap-3 border-b bg-surface-subtle px-4 py-2 text-xs font-semibold text-muted">
            <span>名前</span>
            <span>メンバー</span>
            <span>タイプ</span>
            <span>権限</span>
            <span>操作</span>
          </div>
          {roles.map((role) => (
            <div
              key={role.id}
              data-role={role.key}
              className="grid grid-cols-[minmax(220px,1.4fr)_120px_130px_120px_120px] items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">{role.name}</span>
                  {role.is_super && (
                    <span className="rounded bg-warning-soft px-1 text-[10px] text-warning">特権</span>
                  )}
                  {role.is_system && !role.is_super && (
                    <span className="rounded bg-surface-muted px-1 text-[10px] text-muted">標準</span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-muted">{role.description}</span>
              </span>
              <span className="text-xs text-secondary">{role.member_count} 人</span>
              <span className="text-xs text-secondary">
                {role.is_system ? "標準" : "カスタム"} / {BASE_LABEL[role.base_level]}
              </span>
              <span className="text-xs text-secondary">{role.permissions.length} 件</span>
              <span className="flex gap-1 text-xs">
                {!role.is_system && (
                  <>
                    <button
                      onClick={() => openEdit(role)}
                      className="rounded border px-1.5 py-0.5 hover:bg-hover"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => remove(role)}
                      className="rounded border border-danger-line px-1.5 py-0.5 text-danger hover:bg-danger-soft"
                    >
                      削除
                    </button>
                  </>
                )}
                {role.is_system && <span className="text-[11px] text-subtle">変更不可</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-line bg-surface-subtle p-3 text-xs text-secondary">
        <strong className="font-semibold text-secondary">標準の役割</strong> は変更できません。カスタム役割では
        管理コンソールの権限とワークスペースの操作権限を個別に付与できます。
      </div>

      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}

      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-scrim p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="役割を作成"
            data-role-dialog
          >
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold">{editing ? "役割を編集" : "カスタム役割を作成"}</h3>
              <button onClick={() => setOpen(false)} aria-label="閉じる" className="rounded p-1 text-muted hover:bg-hover">
                ×
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="text-xs text-secondary">
                役割名
                <input value={name} onChange={(e) => setName(e.target.value)} className={field} data-role-name-input />
              </label>
              <label className="text-xs text-secondary">
                説明
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className={`${field} resize-y`}
                />
              </label>
              <label className="text-xs text-secondary">
                基本の役割
                <select
                  value={baseLevel}
                  onChange={(e) => {
                    const next = e.target.value as AdminRole["base_level"];
                    setBaseLevel(next);
                    setPermissions((prev) => prev.filter((p) => next === "admin" || MEMBER_ONLY.includes(p)));
                  }}
                  className={field}
                >
                  <option value="member">メンバー</option>
                  <option value="guest">ゲスト</option>
                  <option value="admin">管理者</option>
                </select>
                <span className="mt-1 block text-[11px] text-subtle">{BASE_LEVEL_HINT[baseLevel]}</span>
              </label>
              <div>
                <div className="text-xs text-secondary">権限</div>
                <div className="mt-1 grid gap-1 rounded border p-2 sm:grid-cols-2">
                  {PERMISSION_CATALOG.map((permission) => {
                    const disabled = !allowedPermissions.includes(permission.key);
                    return (
                      <label
                        key={permission.key}
                        className={`flex items-start gap-2 rounded px-1.5 py-1 text-xs ${
                          disabled ? "opacity-40" : "hover:bg-hover"
                        }`}
                        title={permission.description}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={permissions.includes(permission.key)}
                          disabled={disabled}
                          onChange={() => togglePermission(permission.key)}
                        />
                        <span>
                          <span className="font-medium">{permission.label}</span>
                          <span className="block text-[10px] text-subtle">{permission.group}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-subtle">
                  管理コンソールの権限は「管理者」を基本の役割にした場合のみ付与できます。
                </p>
              </div>
            </div>
            {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded px-3 py-1.5 text-sm text-secondary hover:bg-hover">
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                className="rounded bg-accent px-4 py-1.5 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? "保存中…" : editing ? "変更を保存" : "役割を作成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

