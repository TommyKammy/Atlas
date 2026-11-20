"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { api } from "@/lib/api-client";
import { useEffect, useRef, useState } from "react";
import UserAvatar from "./UserAvatar";
import {
  PROJECT_ROLE_DESCRIPTIONS,
  PROJECT_ROLE_LABELS,
  PROJECT_ROLES,
  type ProjectRole,
} from "@/lib/project-roles";

type Member = {
  id: number;
  name: string;
  email: string | null;
  title: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  is_admin?: boolean;
  deactivated_at: string | null;
  role: ProjectRole;
};

type DirectoryUser = {
  id: number;
  name: string;
  email: string | null;
  title: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  is_admin?: boolean;
};


export default function ProjectMembersManager({
  projectId,
  autoFocusAdd = false,
}: {
  projectId: number;
  autoFocusAdd?: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [canManageAdmins, setCanManageAdmins] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<ProjectRole>("editor");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const addSelectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (autoFocusAdd && canManage) addSelectRef.current?.focus();
  }, [autoFocusAdd, canManage]);

  const load = async () => {
    const data = await api<{ members: Member[]; can_manage: boolean; can_manage_admins: boolean; current_user_id: number }>(`/api/projects/${projectId}/members`);
    setMembers(Array.isArray(data?.members) ? data.members : []);
    setCanManage(data?.can_manage === true);
    setCanManageAdmins(data?.can_manage_admins === true);
    setCurrentUserId(typeof data?.current_user_id === "number" ? data.current_user_id : null);
    if (data?.can_manage) {
      const directory = await api<{ users: DirectoryUser[] }>("/api/users");
      setUsers(Array.isArray(directory?.users) ? directory.users : []);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const add = async () => {
    const userId = Number(addUserId);
    if (!Number.isInteger(userId) || userId <= 0) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/projects/${projectId}/members`, "POST", { user_id: userId, role: addRole });
      setAddUserId("");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId: number, role: ProjectRole) => {
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/projects/${projectId}/members/${userId}`, "PATCH", { role });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: Member) => {
    if (!await confirmAction(`「${member.name}」をプロジェクトから除外しますか？`)) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/projects/${projectId}/members/${member.id}`, "DELETE");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const memberIds = new Set(members.map((m) => m.id));
  const candidates = users.filter((u) => !memberIds.has(u.id) && (canManageAdmins || !u.is_admin));

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">メンバー</h2>
        <span className="text-xs text-muted">{members.length}人</span>
      </div>

      {canManage && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <select
            ref={addSelectRef}
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            aria-label="追加するユーザー"
            className="h-8 min-w-40 flex-1 rounded-md border border-field-line bg-field px-2 text-sm"
          >
            <option value="">ユーザーを選択…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.is_guest ? "（ゲスト）" : ""}
              </option>
            ))}
          </select>
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as ProjectRole)}
            className="h-8 rounded-md border border-field-line bg-field px-2 text-xs"
            title={PROJECT_ROLE_DESCRIPTIONS[addRole]}
          >
            {PROJECT_ROLES.filter((r) => canManageAdmins || r !== "admin").map((r) => (
              <option key={r} value={r}>
                {PROJECT_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={add}
            disabled={busy || !addUserId}
            className="h-8 rounded-md bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            追加
          </button>
        </div>
      )}

      <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-line-subtle">
        {members.length === 0 && (
          <div className="px-3 py-3 text-sm text-muted">メンバーがいません。</div>
        )}
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 border-b border-line-subtle px-2 py-1.5 last:border-b-0">
            <UserAvatar name={m.name} url={m.avatar_url} className="h-7 w-7" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate text-sm font-medium">{m.name}</span>
                {m.is_guest && (
                  <span className="rounded bg-warning-soft px-1 text-[10px] text-warning">ゲスト</span>
                )}
                {m.deactivated_at && (
                  <span className="rounded bg-surface-strong px-1 text-[10px] text-secondary">無効</span>
                )}
                {m.id === currentUserId && (
                  <span className="rounded bg-surface-muted px-1 text-[10px] text-muted">あなた</span>
                )}
              </div>
              <div className="truncate text-[11px] text-muted">
                {m.title ? `${m.title} ・ ` : ""}
                {m.email ?? ""}
              </div>
            </div>
            {canManage && (canManageAdmins || m.role !== "admin" && !m.is_admin && m.id !== currentUserId) ? (
              <>
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.id, e.target.value as ProjectRole)}
                  disabled={busy}
                  className="h-7 rounded border border-field-line bg-field px-1 text-xs"
                  title={PROJECT_ROLE_DESCRIPTIONS[m.role]}
                >
                  {PROJECT_ROLES.filter((r) => canManageAdmins || r !== "admin").map((r) => (
                    <option key={r} value={r}>
                      {PROJECT_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => remove(m)}
                  disabled={busy}
                  className="text-subtle hover:text-danger"
                  title="プロジェクトから除外"
                >
                  ×
                </button>
              </>
            ) : (
              <span className="text-xs text-muted">{PROJECT_ROLE_LABELS[m.role]}</span>
            )}
          </div>
        ))}
      </div>
      {msg && <p className="mt-2 text-xs text-danger">{msg}</p>}
    </section>
  );
}
