"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmAction } from "@/lib/ui-feedback";
import { api } from "@/lib/api-client";
import { PERMISSION_CATALOG, type Permission } from "@/lib/permission-catalog";
import type { AdminRole } from "@/lib/admin-data";
import {
  checkboxClass,
  dialogCloseClass,
  dialogSubtitleClass,
  dialogTitleClass,
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  fieldTextareaClass,
  pillClass,
  pillWarningClass,
  primaryButtonClass,
  secondaryButtonClass,
  SelectControl,
  smallQuietButtonClass,
  smallQuietDangerButtonClass,
} from "../ui/form-controls";
import UserAvatar from "../UserAvatar";
import { SectionHeader } from "./SectionHeader";

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

const ROLE_GRID =
  "grid grid-cols-[minmax(220px,1.4fr)_120px_150px_110px_130px] items-center gap-3";

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
  const [detailId, setDetailId] = useState<number | null>(null);

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
        <button onClick={openCreate} data-role-create className={primaryButtonClass}>
          役割を作成
        </button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[760px]">
          <div className={`${ROLE_GRID} border-b border-line px-2 py-2 text-[12px] font-medium text-muted`}>
            <span>名前</span>
            <span>メンバー</span>
            <span>タイプ</span>
            <span>権限</span>
            <span>操作</span>
          </div>
          {roles.map((role) => {
            const detailOpen = detailId === role.id;
            const detailDomId = `role-detail-${role.id}`;
            return (
              <Fragment key={role.id}>
                <div
                  data-role={role.key}
                  className={`${ROLE_GRID} min-h-[44px] border-b border-line-subtle px-2 py-2 text-[13px] hover:bg-hover ${
                    detailOpen ? "bg-surface-subtle" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-text">{role.name}</span>
                      {role.is_super && <span className={pillWarningClass}>特権</span>}
                      {role.is_system && !role.is_super && <span className={pillClass}>標準</span>}
                    </span>
                    {role.description && (
                      <span title={role.description} className="block truncate text-[12px] text-muted">
                        {role.description}
                      </span>
                    )}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5" data-role-members>
                    {role.members.length > 0 && (
                      <span
                        className="flex shrink-0 -space-x-1.5"
                        title={role.members.map((member) => member.name).join("、")}
                      >
                        {role.members.slice(0, 3).map((member) => (
                          <UserAvatar
                            key={member.id}
                            name={member.name}
                            url={member.avatar_url}
                            className="h-5 w-5 ring-2 ring-surface"
                            textClassName="text-[8px]"
                          />
                        ))}
                      </span>
                    )}
                    <span className="text-[12px] tabular-nums text-secondary">{role.member_count} 人</span>
                  </span>
                  <span className="text-[12px] text-secondary">
                    {role.is_system ? "標準" : "カスタム"} / {BASE_LABEL[role.base_level]}
                  </span>
                  <span className="text-[12px] tabular-nums text-secondary">{role.permissions.length} 件</span>
                  <span className="flex flex-wrap items-center gap-1">
                    <button
                      onClick={() => setDetailId(detailOpen ? null : role.id)}
                      aria-expanded={detailOpen}
                      aria-controls={detailDomId}
                      title={`${role.name}の権限とメンバーを${detailOpen ? "閉じる" : "表示"}`}
                      className={smallQuietButtonClass}
                      data-role-detail-toggle
                    >
                      {detailOpen ? "閉じる" : "詳細"}
                    </button>
                    {!role.is_system && (
                      <>
                        <button
                          onClick={() => openEdit(role)}
                          title={`${role.name}を編集`}
                          className={smallQuietButtonClass}
                        >
                          編集
                        </button>
                        <button
                          onClick={() => remove(role)}
                          title={`${role.name}を削除`}
                          className={smallQuietDangerButtonClass}
                        >
                          削除
                        </button>
                      </>
                    )}
                    {role.is_system && <span className="text-[12px] text-muted">変更不可</span>}
                  </span>
                </div>
                {detailOpen && <RoleDetail role={role} id={detailDomId} />}
              </Fragment>
            );
          })}
        </div>
      </div>

      <div className="mt-3 max-w-3xl rounded-md bg-surface-subtle px-3 py-2 text-[12px] leading-5 text-secondary">
        <strong className="font-semibold text-secondary">標準の役割</strong> は変更できません。カスタム役割では
        管理コンソールの権限とワークスペースの操作権限を個別に付与できます。
      </div>

      {msg && <p className="mt-3 text-[12px] text-danger">{msg}</p>}

      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-scrim p-4" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="役割を作成"
            data-role-dialog
          >
            <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div className="min-w-0">
                <h3 className={dialogTitleClass}>{editing ? "役割を編集" : "カスタム役割を作成"}</h3>
                <p className={dialogSubtitleClass}>役割の名前と付与する権限を設定します。</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="閉じる" className={dialogCloseClass}>
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-3">
                <label className="block">
                  <span className={fieldLabelClass}>役割名</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={`mt-1.5 ${fieldControlClass}`}
                    data-role-name-input
                  />
                </label>
                <label className="block">
                  <span className={fieldLabelClass}>説明</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className={`mt-1.5 ${fieldTextareaClass}`}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabelClass}>基本の役割</span>
                  <SelectControl
                    containerClassName="mt-1.5"
                    value={baseLevel}
                    onChange={(e) => {
                      const next = e.target.value as AdminRole["base_level"];
                      setBaseLevel(next);
                      setPermissions((prev) => prev.filter((p) => next === "admin" || MEMBER_ONLY.includes(p)));
                    }}
                  >
                    <option value="member">メンバー</option>
                    <option value="guest">ゲスト</option>
                    <option value="admin">管理者</option>
                  </SelectControl>
                  <span className={`mt-1.5 block ${fieldHintClass}`}>{BASE_LEVEL_HINT[baseLevel]}</span>
                </label>
                <div>
                  <div className={fieldLabelClass}>権限</div>
                  <div className="mt-1.5 grid gap-1 rounded-md bg-surface-subtle p-2 sm:grid-cols-2">
                    {PERMISSION_CATALOG.map((permission) => {
                      const disabled = !allowedPermissions.includes(permission.key);
                      return (
                        <label
                          key={permission.key}
                          className={`flex items-start gap-2 rounded px-1.5 py-1 text-[12px] ${
                            disabled ? "opacity-40" : "hover:bg-hover"
                          }`}
                          title={permission.description}
                        >
                          <input
                            type="checkbox"
                            className={`mt-0.5 ${checkboxClass}`}
                            checked={permissions.includes(permission.key)}
                            disabled={disabled}
                            onChange={() => togglePermission(permission.key)}
                          />
                          <span>
                            <span className="font-medium text-text">{permission.label}</span>
                            <span className="block text-[12px] text-muted">{permission.group}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <p className={`mt-1.5 ${fieldHintClass}`}>
                    管理コンソールの権限は「管理者」を基本の役割にした場合のみ付与できます。
                  </p>
                </div>
              </div>
              {msg && <p className="mt-3 text-[12px] text-danger">{msg}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-line-subtle px-5 py-3">
              <button onClick={() => setOpen(false)} className={secondaryButtonClass}>
                キャンセル
              </button>
              <button onClick={save} disabled={saving || !name.trim()} className={primaryButtonClass}>
                {saving ? "保存中…" : editing ? "変更を保存" : "役割を作成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleDetail({ role, id }: { role: AdminRole; id: string }) {
  const granted = new Set(role.permissions);
  const groups = [...new Set(PERMISSION_CATALOG.map((permission) => permission.group))];
  return (
    <div
      id={id}
      data-role-detail={role.key}
      className="grid gap-5 border-b border-line-subtle bg-surface-subtle px-4 py-4 text-[12px] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"
    >
      <section aria-label={`${role.name}の権限`}>
        <h4 className="font-semibold text-secondary">
          権限 <span className="font-normal tabular-nums text-muted">{role.permissions.length} / {PERMISSION_CATALOG.length}</span>
        </h4>
        {role.description && <p className="mt-1 leading-5 text-secondary">{role.description}</p>}
        <p className="mt-1 text-muted">
          基本の役割: {BASE_LABEL[role.base_level]}（{BASE_LEVEL_HINT[role.base_level]}）
          {role.is_system && " ・ 標準の役割のため、権限は変更できません。"}
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group}>
              <div className="text-[11px] font-medium text-muted">{group}</div>
              <ul className="mt-1 grid gap-0.5">
                {PERMISSION_CATALOG.filter((permission) => permission.group === group).map((permission) => {
                  const on = granted.has(permission.key);
                  return (
                    <li
                      key={permission.key}
                      title={permission.description}
                      data-permission={permission.key}
                      data-granted={on ? "true" : "false"}
                      className={`flex items-start gap-1.5 ${on ? "text-text" : "text-muted line-through decoration-line"}`}
                    >
                      <span aria-hidden className={`w-3 shrink-0 text-center ${on ? "text-success" : "text-muted"}`}>
                        {on ? "✓" : "–"}
                      </span>
                      <span>
                        {permission.label}
                        <span className="sr-only">{on ? "（許可）" : "（なし）"}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <section aria-label={`${role.name}のメンバー`}>
        <h4 className="font-semibold text-secondary">
          メンバー <span className="font-normal tabular-nums text-muted">{role.members.length} 人</span>
        </h4>
        {role.members.length === 0 ? (
          <p className="mt-2 text-muted">この役割のメンバーはいません。</p>
        ) : (
          <ul className="mt-2 grid max-h-64 gap-1 overflow-y-auto pr-1">
            {role.members.map((member) => (
              <li key={member.id} className="flex min-w-0 items-center gap-2" data-role-member={member.id}>
                <UserAvatar name={member.name} url={member.avatar_url} className="h-6 w-6" textClassName="text-[9px]" />
                <span className="min-w-0">
                  <span className="block truncate text-text">{member.name}</span>
                  {member.email && <span className="block truncate text-[11px] text-muted">{member.email}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
